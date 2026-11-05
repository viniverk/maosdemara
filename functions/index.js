/**
 * Cloud Functions da loja
 *  - createCheckout   : cria o pedido e a preferência de pagamento no Mercado Pago
 *  - mpWebhook        : recebe as notificações do Mercado Pago e atualiza o pedido/estoque
 *  - publishInstagram : publica as fotos do produto no feed do Instagram (somente admin)
 */
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions, logger } = require("firebase-functions/v2");
const { defineSecret, defineString } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = admin.firestore;

setGlobalOptions({ region: "southamerica-east1", maxInstances: 10 });

// Segredos (definidos com: firebase functions:secrets:set NOME)
const MP_ACCESS_TOKEN = defineSecret("MP_ACCESS_TOKEN");
const IG_ACCESS_TOKEN = defineSecret("IG_ACCESS_TOKEN");
// Parâmetros comuns (arquivo functions/.env)
const SITE_URL = defineString("SITE_URL");
const STORE_NAME = defineString("STORE_NAME", { default: "Loja" });
const IG_USER_ID = defineString("IG_USER_ID", { default: "" });
const IG_API_HOST = defineString("IG_API_HOST", { default: "https://graph.instagram.com" });
const IG_API_VERSION = defineString("IG_API_VERSION", { default: "v26.0" });

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const clean = (s, max = 200) => String(s ?? "").trim().slice(0, max);

// =====================================================================
// 1) Checkout — o preço SEMPRE vem do banco, nunca do navegador
// =====================================================================
exports.createCheckout = onCall({ secrets: [MP_ACCESS_TOKEN] }, async (req) => {
  const { items, customer } = req.data || {};
  if (!Array.isArray(items) || items.length < 1 || items.length > 30) {
    throw new HttpsError("invalid-argument", "Sacola vazia ou inválida.");
  }
  const c = {
    name: clean(customer?.name, 120), email: clean(customer?.email, 160), phone: clean(customer?.phone, 30),
    cep: clean(customer?.cep, 12), street: clean(customer?.street), number: clean(customer?.number, 20),
    complement: clean(customer?.complement), district: clean(customer?.district, 120),
    city: clean(customer?.city, 120), notes: clean(customer?.notes, 500),
  };
  for (const k of ["name", "email", "phone", "cep", "street", "number", "district", "city"]) {
    if (!c[k]) throw new HttpsError("invalid-argument", "Preencha todos os dados de entrega.");
  }
  if (!isEmail(c.email)) throw new HttpsError("invalid-argument", "E-mail inválido.");

  // Junta quantidades do mesmo produto
  const qtyById = {};
  for (const it of items) {
    const id = clean(it?.id, 100);
    const qty = parseInt(it?.qty, 10);
    if (!id || !(qty >= 1 && qty <= 20)) throw new HttpsError("invalid-argument", "Item inválido.");
    qtyById[id] = (qtyById[id] || 0) + qty;
  }

  const ids = Object.keys(qtyById);
  const snaps = await db.getAll(...ids.map((id) => db.collection("products").doc(id)));
  const orderItems = [];
  for (const s of snaps) {
    const p = s.data();
    if (!s.exists || !p.active) throw new HttpsError("failed-precondition", "Um dos produtos não está mais disponível.");
    const qty = qtyById[s.id];
    if ((p.stock || 0) < qty) throw new HttpsError("failed-precondition", `"${p.name}" tem apenas ${p.stock} em estoque.`);
    orderItems.push({ productId: s.id, name: p.name, price: Number(p.price), qty, image: p.images?.[0] || "" });
  }

  const settingsSnap = await db.doc("settings/store").get();
  const st = settingsSnap.exists ? settingsSnap.data() : {};
  const subtotal = round2(orderItems.reduce((s, i) => s + i.price * i.qty, 0));
  const free = Number(st.freeShippingOver) > 0 && subtotal >= Number(st.freeShippingOver);
  const shipping = free ? 0 : round2(Number(st.shippingFee || 0));
  const total = round2(subtotal + shipping);

  const orderRef = db.collection("orders").doc();
  await orderRef.set({
    items: orderItems, subtotal, shipping, total, customer: c,
    status: "pending", stockDeducted: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  const site = SITE_URL.value().replace(/\/$/, "");
  const [firstName, ...rest] = c.name.split(" ");
  const phoneDigits = c.phone.replace(/\D/g, "").replace(/^55/, "");
  const preference = {
    items: orderItems.map((i) => ({
      id: i.productId, title: i.name, quantity: i.qty, unit_price: i.price,
      currency_id: "BRL", picture_url: i.image || undefined, category_id: "fashion",
    })),
    payer: {
      name: firstName, surname: rest.join(" "), email: c.email,
      phone: { area_code: phoneDigits.slice(0, 2), number: phoneDigits.slice(2) },
      address: { zip_code: c.cep.replace(/\D/g, ""), street_name: c.street, street_number: c.number },
    },
    shipments: shipping > 0 ? { cost: shipping, mode: "not_specified" } : undefined,
    external_reference: orderRef.id,
    back_urls: {
      success: `${site}/pedido.html`,
      pending: `${site}/pedido.html`,
      failure: `${site}/pedido.html`,
    },
    auto_return: "approved",
    notification_url: `${site}/api/mp-webhook`,
    statement_descriptor: STORE_NAME.value().replace(/[^A-Za-z0-9 ]/g, "").slice(0, 13) || undefined,
    payment_methods: { installments: 6 },
  };

  const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MP_ACCESS_TOKEN.value()}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": orderRef.id,
    },
    body: JSON.stringify(preference),
  });
  const pref = await res.json();
  if (!res.ok) {
    logger.error("Erro Mercado Pago", pref);
    await orderRef.update({ status: "cancelled", error: JSON.stringify(pref).slice(0, 500) });
    throw new HttpsError("internal", "Não foi possível iniciar o pagamento. Tente novamente.");
  }
  await orderRef.update({ preferenceId: pref.id });
  return { orderId: orderRef.id, checkoutUrl: pref.init_point };
});

// =====================================================================
// 2) Webhook do Mercado Pago
//    Por segurança, NÃO confiamos no corpo recebido: buscamos o pagamento
//    direto na API do Mercado Pago com o nosso token.
// =====================================================================
exports.mpWebhook = onRequest({ secrets: [MP_ACCESS_TOKEN] }, async (req, res) => {
  try {
    const type = req.query.type || req.query.topic || req.body?.type || req.body?.topic;
    const paymentId = req.query["data.id"] || req.body?.data?.id || (type === "payment" ? req.query.id : null);
    if (type !== "payment" || !paymentId) { res.status(200).send("ignorado"); return; }

    const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN.value()}` },
    });
    if (!r.ok) { logger.warn("Pagamento não encontrado", paymentId); res.status(200).send("ok"); return; }
    const pay = await r.json();
    const orderId = pay.external_reference;
    if (!orderId) { res.status(200).send("sem referência"); return; }

    const statusMap = {
      approved: "approved", authorized: "pending", pending: "pending", in_process: "pending", in_mediation: "pending",
      rejected: "rejected", cancelled: "cancelled", refunded: "cancelled", charged_back: "cancelled",
    };
    const newStatus = statusMap[pay.status] || "pending";
    const orderRef = db.collection("orders").doc(orderId);

    await db.runTransaction(async (tx) => {
      const os = await tx.get(orderRef);
      if (!os.exists) return;
      const order = os.data();
      // não "volta" um pedido que o admin já marcou como enviado/entregue
      if (["shipped", "delivered"].includes(order.status) && newStatus === "approved") return;

      const productRefs = order.items.map((i) => db.collection("products").doc(i.productId));
      const productSnaps = await Promise.all(productRefs.map((pr) => tx.get(pr)));
      const update = {
        status: newStatus,
        paymentId: String(pay.id),
        paymentStatus: pay.status,
        paymentMethod: pay.payment_type_id || "",
        paidAmount: pay.transaction_amount ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (newStatus === "approved" && !order.stockDeducted) {
        order.items.forEach((it, idx) => {
          if (productSnaps[idx].exists) tx.update(productRefs[idx], { stock: FieldValue.increment(-it.qty) });
        });
        update.stockDeducted = true;
        update.paidAt = FieldValue.serverTimestamp();
      }
      if (newStatus === "cancelled" && order.stockDeducted) {     // estorno: devolve estoque
        order.items.forEach((it, idx) => {
          if (productSnaps[idx].exists) tx.update(productRefs[idx], { stock: FieldValue.increment(it.qty) });
        });
        update.stockDeducted = false;
      }
      tx.update(orderRef, update);
    });
    res.status(200).send("ok");
  } catch (e) {
    logger.error("Erro no webhook", e);
    res.status(500).send("erro"); // o Mercado Pago tenta de novo
  }
});

// =====================================================================
// 3) Publicar no Instagram (API oficial — conta profissional)
// =====================================================================
exports.publishInstagram = onCall({ secrets: [IG_ACCESS_TOKEN], timeoutSeconds: 120 }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Faça login.");
  const adm = await db.doc(`admins/${req.auth.uid}`).get();
  if (!adm.exists) throw new HttpsError("permission-denied", "Apenas administradores.");

  const igUser = IG_USER_ID.value();
  const token = IG_ACCESS_TOKEN.value();
  if (!igUser || !token || token === "nao-configurado") {
    throw new HttpsError("failed-precondition", "Publicação automática não configurada (IG_USER_ID / IG_ACCESS_TOKEN). Use o botão Compartilhar.");
  }

  const productId = clean(req.data?.productId, 100);
  const caption = clean(req.data?.caption, 2200);
  const ps = await db.collection("products").doc(productId).get();
  if (!ps.exists) throw new HttpsError("not-found", "Produto não encontrado.");
  const images = (ps.data().images || []).slice(0, 10);
  if (!images.length) throw new HttpsError("failed-precondition", "O produto não tem fotos.");

  const base = `${IG_API_HOST.value()}/${IG_API_VERSION.value()}`;
  const call = async (path, params, method = "POST") => {
    const url = new URL(`${base}/${path}`);
    const opts = { method, headers: { Authorization: `Bearer ${token}` } };
    if (method === "GET") Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
    else { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(params); }
    const r = await fetch(url, opts);
    const j = await r.json();
    if (!r.ok || j.error) {
      logger.error("Erro Instagram", j);
      throw new HttpsError("internal", `Instagram: ${j.error?.error_user_msg || j.error?.message || "erro desconhecido"}`);
    }
    return j;
  };
  const waitReady = async (id) => {
    for (let i = 0; i < 15; i++) {
      const s = await call(id, { fields: "status_code" }, "GET");
      if (s.status_code === "FINISHED") return;
      if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new HttpsError("internal", "O Instagram não conseguiu processar a imagem.");
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new HttpsError("deadline-exceeded", "O Instagram demorou para processar. Tente novamente.");
  };

  let creationId;
  if (images.length === 1) {
    creationId = (await call(`${igUser}/media`, { image_url: images[0], caption })).id;
  } else {
    const children = [];
    for (const url of images) children.push((await call(`${igUser}/media`, { image_url: url, is_carousel_item: true })).id);
    for (const id of children) await waitReady(id);
    creationId = (await call(`${igUser}/media`, { media_type: "CAROUSEL", children: children.join(","), caption })).id;
  }
  await waitReady(creationId);
  const published = await call(`${igUser}/media_publish`, { creation_id: creationId });
  let permalink = "";
  try { permalink = (await call(published.id, { fields: "permalink" }, "GET")).permalink || ""; } catch {}

  await ps.ref.update({
    instagramPostId: published.id,
    instagramPermalink: permalink,
    instagramPostedAt: FieldValue.serverTimestamp(),
  });
  return { id: published.id, permalink };
});

function round2(n) { return Math.round(n * 100) / 100; }
