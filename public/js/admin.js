import { db, auth, storage, functions } from "./firebase.js";
import { STORE, MODE, CLOUDINARY } from "./config.js";
import { brl, esc, toast, copyText, productUrl, urlToFile, downloadBlob, slug } from "./utils.js";
import { signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail, GoogleAuthProvider, signInWithPopup, signInWithRedirect } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, orderBy, limit, serverTimestamp, writeBatch, increment } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const $ = (s) => document.querySelector(s);
const show = (id) => ["loginView", "noAdminView", "appView"].forEach((v) => $("#" + v).classList.toggle("hidden", v !== id));

let products = [];
let orders = [];
let settings = { shippingFee: 0, freeShippingOver: 0, hashtags: "#bolsaartesanal #feitoamao #artesanato", captionFooter: "🛍️ Compre pelo link na bio" };

$("#logo").textContent = `${STORE.name} · Painel`;
if (MODE !== "blaze") $("#igAuto").classList.add("hidden");

// =================== Autenticação ===================
onAuthStateChanged(auth, async (user) => {
  $("#logout").classList.toggle("hidden", !user);
  $("#who").textContent = user?.email || "";
  if (!user) return show("loginView");
  const adm = await getDoc(doc(db, "admins", user.uid)).catch(() => null);
  if (!adm?.exists()) { $("#uidBox").textContent = user.uid; return show("noAdminView"); }
  show("appView");
  await Promise.all([loadSettings(), loadProducts()]);
});

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  try { await signInWithEmailAndPassword(auth, f.email.value, f.password.value); }
  catch { toast("E-mail ou senha inválidos"); }
});
$("#googleLogin").onclick = async () => {
  const provider = new GoogleAuthProvider();
  try { await signInWithPopup(auth, provider); }
  catch (e) {
    if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") return signInWithRedirect(auth, provider);
    if (e.code !== "auth/popup-closed-by-user") toast("Não foi possível entrar: " + (e.code || e.message), 5000);
  }
};
$("#forgot").onclick = async () => {
  const email = $("#loginForm").email.value;
  if (!email) return toast("Digite seu e-mail primeiro");
  await sendPasswordResetEmail(auth, email).catch(() => {});
  toast("Se o e-mail existir, enviamos um link de redefinição");
};
$("#logout").onclick = () => signOut(auth);
$("#copyUid").onclick = async () => { await copyText($("#uidBox").textContent); toast("ID copiado"); };

// =================== Abas ===================
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
  document.querySelectorAll("[data-panel]").forEach((p) => p.classList.toggle("hidden", p.dataset.panel !== t.dataset.tab));
  if (t.dataset.tab === "orders") loadOrders();
}));

document.querySelectorAll(".overlay").forEach((o) => o.addEventListener("click", (e) => {
  if (e.target === o || e.target.closest("[data-close]")) o.classList.add("hidden");
}));

// =================== Configurações ===================
async function loadSettings() {
  const s = await getDoc(doc(db, "settings", "store"));
  if (s.exists()) settings = { ...settings, ...s.data() };
  const f = $("#settingsForm");
  for (const k of ["shippingFee", "freeShippingOver", "hashtags", "captionFooter"]) f[k].value = settings[k] ?? "";
}
$("#settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  settings = {
    ...settings,
    shippingFee: Number(f.shippingFee.value || 0),
    freeShippingOver: Number(f.freeShippingOver.value || 0),
    hashtags: f.hashtags.value.trim(),
    captionFooter: f.captionFooter.value.trim(),
  };
  await setDoc(doc(db, "settings", "store"), settings, { merge: true });
  toast("Configurações salvas");
});

// =================== Produtos ===================
async function loadProducts() {
  const snap = await getDocs(collection(db, "products"));
  products = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  products.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  renderProducts();
}

function renderProducts() {
  $("#cats").innerHTML = [...new Set(products.map((p) => p.category).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join("");
  if (!products.length) { $("#plist").innerHTML = `<p class="empty">Nenhuma bolsa cadastrada ainda. Clique em “+ Nova bolsa”.</p>`; return; }
  $("#plist").innerHTML = products.map((p) => `
    <div class="prow">
      <img src="${esc(p.images?.[0] || "")}" alt="" />
      <div>
        <strong>${esc(p.name)}</strong> <span class="pill ${p.active ? "on" : "off"}">${p.active ? "visível" : "oculta"}</span>
        ${p.featured ? `<span class="pill on">destaque</span>` : ""}
        <div class="meta">${brl(p.price)} · estoque: ${p.stock}${p.category ? " · " + esc(p.category) : ""}${p.instagramPermalink ? ` · <a href="${esc(p.instagramPermalink)}" target="_blank">ver post</a>` : ""}</div>
      </div>
      <div class="actions">
        <button class="btn small ig-btn" data-ig="${p.id}">Instagram</button>
        <button class="btn ghost small" data-edit="${p.id}">Editar</button>
        <button class="btn ghost small" data-del="${p.id}">Excluir</button>
      </div>
    </div>`).join("");
}

$("#plist").addEventListener("click", async (e) => {
  const t = e.target;
  if (t.dataset.edit) openProductForm(products.find((p) => p.id === t.dataset.edit));
  if (t.dataset.ig) openInstagram(products.find((p) => p.id === t.dataset.ig));
  if (t.dataset.del) {
    const p = products.find((x) => x.id === t.dataset.del);
    if (!confirm(`Excluir "${p.name}"? Esta ação não pode ser desfeita.`)) return;
    await Promise.all((p.imagePaths || []).filter(Boolean).map((path) => deleteObject(ref(storage, path)).catch(() => {})));
    await deleteDoc(doc(db, "products", p.id));
    toast("Produto excluído");
    loadProducts();
  }
});

// ---- Formulário de produto ----
let editing = null;     // produto em edição (ou null)
let imageItems = [];    // [{url, path}] já salvas ou {file, url(preview)} novas
let removedPaths = [];

$("#newProduct").onclick = () => openProductForm(null);

function openProductForm(p) {
  editing = p;
  removedPaths = [];
  imageItems = (p?.images || []).map((url, i) => ({ url, path: p.imagePaths?.[i] }));
  const f = $("#productForm");
  f.reset();
  $("#pmTitle").textContent = p ? "Editar bolsa" : "Nova bolsa";
  if (p) for (const k of ["name", "price", "stock", "category", "dimensions", "materials", "description"]) f[k].value = p[k] ?? "";
  f.active.checked = p ? !!p.active : true;
  f.featured.checked = !!p?.featured;
  renderImageGrid();
  $("#productModal").classList.remove("hidden");
}

function renderImageGrid() {
  $("#imgGrid").innerHTML = imageItems.map((it, i) => `
    <div class="thumb">
      <img src="${esc(it.url)}" alt="" />
      ${i === 0 ? `<span class="first">capa</span>` : `<button type="button" data-first="${i}" title="Tornar capa" style="right:22px;background:var(--accent)">★</button>`}
      <button type="button" data-rm="${i}" title="Remover">✕</button>
    </div>`).join("");
}
$("#imgGrid").addEventListener("click", (e) => {
  const rm = e.target.dataset.rm, first = e.target.dataset.first;
  if (rm !== undefined) {
    const [it] = imageItems.splice(Number(rm), 1);
    if (it.path) removedPaths.push(it.path);
  }
  if (first !== undefined) imageItems.unshift(...imageItems.splice(Number(first), 1));
  renderImageGrid();
});
$("#addUrl").addEventListener("click", () => {
  const url = $("#imgUrl").value.trim();
  if (!/^https:\/\//.test(url)) return toast("Cole um link que comece com https://");
  if (imageItems.length >= 10) return toast("Máximo de 10 fotos");
  imageItems.push({ url, path: "" });
  $("#imgUrl").value = "";
  renderImageGrid();
});
$("#fileInput").addEventListener("change", async (e) => {
  const files = [...e.target.files].slice(0, 10 - imageItems.length);
  for (const file of files) {
    try {
      const blob = await prepareImage(file);
      imageItems.push({ file: blob, url: URL.createObjectURL(blob) });
    } catch { toast(`Não consegui ler ${file.name}`); }
  }
  e.target.value = "";
  renderImageGrid();
});

/**
 * Redimensiona para no máx. 1440px e salva em JPEG.
 * Também ajusta a proporção para ficar entre 4:5 e 1.91:1 (exigência do Instagram):
 * corta levemente se a diferença for pequena, senão completa com fundo claro.
 */
async function prepareImage(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  let sw = bmp.width, sh = bmp.height, sx = 0, sy = 0;
  let outW = sw, outH = sh, padX = 0, padY = 0;
  const r = sw / sh;
  if (r < 0.8) {               // muito alta
    const targetH = sw / 0.8;
    if (targetH / sh >= 0.88) { sy = (sh - targetH) / 2; sh = targetH; outH = sh; }
    else { outW = sh * 0.8; padX = (outW - sw) / 2; }
  } else if (r > 1.91) {       // muito larga
    const targetW = sh * 1.91;
    if (targetW / sw >= 0.88) { sx = (sw - targetW) / 2; sw = targetW; outW = sw; }
    else { outH = sw / 1.91; padY = (outH - sh) / 2; }
  }
  const scale = Math.min(1, 1440 / Math.max(outW, outH));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(outW * scale);
  canvas.height = Math.round(outH * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f7f1e8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, sx, sy, sw, sh, padX * scale, padY * scale, sw * scale, sh * scale);
  return await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej()), "image/jpeg", 0.86));
}

async function uploadCloudinary(blob, name) {
  if (!CLOUDINARY.cloudName || !CLOUDINARY.uploadPreset) {
    throw new Error("Configure o Cloudinary em js/config.js (ou adicione as fotos por link).");
  }
  const fd = new FormData();
  fd.append("file", blob, name + ".jpg");
  fd.append("upload_preset", CLOUDINARY.uploadPreset);
  fd.append("folder", "maosdemara");
  const r = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/image/upload`, { method: "POST", body: fd });
  const j = await r.json();
  if (!r.ok) throw new Error("Cloudinary: " + (j.error?.message || r.status));
  return j.secure_url;
}

$("#productForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  if (!imageItems.length) return toast("Adicione pelo menos uma foto");
  const btn = $("#saveProduct");
  btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Salvando…`;
  try {
    const pref = editing ? doc(db, "products", editing.id) : doc(collection(db, "products"));
    const images = [], imagePaths = [];
    for (const [i, it] of imageItems.entries()) {
      if (it.file && MODE !== "blaze") {
        images.push(await uploadCloudinary(it.file, `${slug(f.name.value).slice(0, 30)}-${Date.now()}-${i}`));
        imagePaths.push("");
      } else if (it.file) {
        const path = `products/${pref.id}/${Date.now()}-${i}-${slug(f.name.value).slice(0, 30)}.jpg`;
        const r = ref(storage, path);
        await uploadBytes(r, it.file, { contentType: "image/jpeg", cacheControl: "public,max-age=31536000" });
        images.push(await getDownloadURL(r));
        imagePaths.push(path);
      } else { images.push(it.url); imagePaths.push(it.path || ""); }
    }
    const data = {
      name: f.name.value.trim(),
      price: Math.round(Number(f.price.value) * 100) / 100,
      stock: Math.max(0, parseInt(f.stock.value, 10) || 0),
      category: f.category.value.trim(),
      dimensions: f.dimensions.value.trim(),
      materials: f.materials.value.trim(),
      description: f.description.value.trim(),
      active: f.active.checked,
      featured: f.featured.checked,
      images, imagePaths,
      updatedAt: serverTimestamp(),
    };
    if (!editing) data.createdAt = serverTimestamp();
    await setDoc(pref, data, { merge: true });
    await Promise.all(removedPaths.map((p) => deleteObject(ref(storage, p)).catch(() => {})));
    $("#productModal").classList.add("hidden");
    toast("Produto salvo");
    await loadProducts();
    if (!editing && confirm("Produto criado! Quer postar no Instagram agora?")) openInstagram(products.find((p) => p.id === pref.id));
  } catch (err) {
    console.error(err);
    toast("Erro ao salvar: " + (err.code || err.message), 5000);
  } finally {
    btn.disabled = false; btn.textContent = "Salvar";
  }
});

// =================== Instagram ===================
let igProduct = null;
let igFiles = [];

function buildCaption(p) {
  return [
    `✨ ${p.name}`,
    p.description,
    p.materials ? `🧶 ${p.materials}` : "",
    p.dimensions ? `📏 ${p.dimensions}` : "",
    `💰 ${brl(p.price)}${p.stock === 1 ? " · peça única" : ""}`,
    `${settings.captionFooter || "🛍️ Compre pelo link na bio"}\n${productUrl(p.id)}`,
    settings.hashtags,
  ].filter(Boolean).join("\n\n");
}

async function openInstagram(p) {
  if (!p) return;
  igProduct = p;
  igFiles = [];
  $("#igPreview").innerHTML = (p.images || []).map((u) => `<img src="${esc(u)}" alt="" />`).join("");
  $("#igCaption").value = buildCaption(p);
  $("#igShare").disabled = true;
  $("#igShare").innerHTML = `<span class="spinner"></span> Preparando fotos…`;
  $("#igModal").classList.remove("hidden");
  // Baixa as fotos antes, para o botão "Compartilhar" abrir na hora (exigência dos navegadores)
  try {
    igFiles = await Promise.all((p.images || []).map((u, i) => urlToFile(u, `${slug(p.name)}-${i + 1}.jpg`)));
  } catch (e) {
    console.warn("Falha ao baixar imagens (verifique o CORS do Storage):", e);
  }
  const canShareFiles = igFiles.length && navigator.canShare?.({ files: igFiles });
  $("#igShare").disabled = !canShareFiles;
  $("#igShare").textContent = canShareFiles ? "📱 Compartilhar no app do Instagram" : "📱 Compartilhar (disponível no celular)";
}

$("#igShare").onclick = () => {
  const caption = $("#igCaption").value;
  copyText(caption); // inicia sem await para não perder o "gesto" do usuário
  navigator.share({ files: igFiles, text: caption, title: igProduct.name })
    .then(() => toast("Legenda copiada — é só colar no Instagram"))
    .catch((e) => { if (e.name !== "AbortError") toast("Não foi possível compartilhar: " + e.message); });
};

$("#igDownload").onclick = async () => {
  await copyText($("#igCaption").value);
  if (!igFiles.length) {
    (igProduct.images || []).forEach((u) => window.open(u, "_blank"));
    return toast("Legenda copiada. Fotos abertas em novas abas para salvar.");
  }
  igFiles.forEach((f, i) => setTimeout(() => downloadBlob(f, f.name), i * 400));
  toast("Legenda copiada e fotos baixadas!");
};

$("#igAuto").onclick = async () => {
  if (!confirm("Publicar agora no feed do Instagram da loja?")) return;
  const btn = $("#igAuto");
  btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Publicando…`;
  try {
    const publish = httpsCallable(functions, "publishInstagram");
    const { data } = await publish({ productId: igProduct.id, caption: $("#igCaption").value });
    toast("Publicado no Instagram! 🎉", 4000);
    if (data.permalink) window.open(data.permalink, "_blank");
    loadProducts();
  } catch (e) {
    console.error(e);
    toast(e.message || "Falha ao publicar", 6000);
  } finally {
    btn.disabled = false; btn.textContent = "⚡ Publicar automaticamente no feed";
  }
};

// =================== Pedidos ===================
const STATUS = { pending: "aguardando pagamento", approved: "pago", shipped: "enviado", delivered: "entregue", rejected: "recusado", cancelled: "cancelado" };

async function loadOrders() {
  $("#olist").innerHTML = `<p class="empty">Carregando…</p>`;
  const snap = await getDocs(query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(200)));
  orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderOrders();
}
$("#orderFilter").onchange = renderOrders;

function renderOrders() {
  const f = $("#orderFilter").value;
  const list = orders.filter((o) => !f || o.status === f || (f === "cancelled" && o.status === "rejected"));
  if (!list.length) { $("#olist").innerHTML = `<p class="empty">Nenhum pedido.</p>`; return; }
  $("#olist").innerHTML = list.map((o) => {
    const c = o.customer || {};
    const date = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString("pt-BR") : "";
    const phone = String(c.phone || "").replace(/\D/g, "");
    return `<div class="order">
      <div class="order-head">
        <div><strong>#${o.code || o.id.slice(0, 8)}</strong> <span class="pill ${o.status}">${STATUS[o.status] || o.status}</span><br/><small>${date}${o.paymentMethod ? " · " + esc(o.paymentMethod) : ""}</small></div>
        <strong>${brl(o.total)}</strong>
      </div>
      ${o.paymentMethod === "pix" && o.status === "pending" ? `<div class="note">💡 Confira no seu banco se entrou um Pix de <b>${brl(o.total)}</b> e confira também se os valores dos itens batem com os preços da loja. Depois mude para <b>pago</b>; o estoque baixa sozinho.</div>` : ""}
      <div>${(o.items || []).map((i) => `${i.qty}× ${esc(i.name)} (${brl(i.price)})`).join("<br/>")}${o.shipping ? `<br/><small>frete ${brl(o.shipping)}</small>` : ""}</div>
      <div><small>
        <b>${esc(c.name)}</b> · ${esc(c.email)} · ${esc(c.phone)}<br/>
        ${esc(c.street)}, ${esc(c.number)} ${esc(c.complement || "")} — ${esc(c.district)} — ${esc(c.city)} — CEP ${esc(c.cep)}
        ${c.notes ? `<br/>Obs.: ${esc(c.notes)}` : ""}
      </small></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <select data-status="${o.id}" style="padding:7px 10px;border:1px solid var(--line);border-radius:8px">
          ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === o.status ? "selected" : ""}>${v}</option>`).join("")}
        </select>
        <input data-tracking="${o.id}" placeholder="Código de rastreio" value="${esc(o.tracking || "")}" style="padding:7px 10px;border:1px solid var(--line);border-radius:8px;flex:1;min-width:140px" />
        <button class="btn small" data-save-order="${o.id}">Salvar</button>
        ${phone ? `<a class="btn ghost small" target="_blank" href="https://wa.me/55${phone.replace(/^55/, "")}?text=${encodeURIComponent(`Olá ${c.name?.split(" ")[0] || ""}! Aqui é da ${STORE.name}, sobre o seu pedido #${o.code || o.id.slice(0, 8)}.`)}">WhatsApp</a>` : ""}
      </div>
    </div>`;
  }).join("");
}

$("#olist").addEventListener("click", async (e) => {
  const id = e.target.dataset.saveOrder;
  if (!id) return;
  const status = document.querySelector(`[data-status="${id}"]`).value;
  const tracking = document.querySelector(`[data-tracking="${id}"]`).value.trim();
  const o = orders.find((x) => x.id === id);
  const batch = writeBatch(db);
  const upd = { status, tracking, updatedAt: serverTimestamp() };
  const paid = ["approved", "shipped", "delivered"].includes(status);
  // Pagou → baixa o estoque (uma vez). Cancelou depois de pago → devolve.
  if (paid && !o.stockDeducted) {
    o.items.forEach((it) => batch.update(doc(db, "products", it.productId), { stock: increment(-it.qty) }));
    upd.stockDeducted = true;
  } else if (["cancelled", "rejected"].includes(status) && o.stockDeducted) {
    o.items.forEach((it) => batch.update(doc(db, "products", it.productId), { stock: increment(it.qty) }));
    upd.stockDeducted = false;
  }
  batch.update(doc(db, "orders", id), upd);
  try { await batch.commit(); } catch (err) { console.error(err); return toast("Erro ao salvar (algum produto foi excluído?)", 4000); }
  Object.assign(o, upd);
  if ("stockDeducted" in upd) loadProducts();
  toast("Pedido atualizado");
  renderOrders();
});
