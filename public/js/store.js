import { db, functions } from "./firebase.js";
import { STORE, MODE, PIX } from "./config.js";
import { pixPayload, qrSvg } from "./pix.js";
import { brl, esc, toast, copyText, productUrl } from "./utils.js";
import { collection, getDocs, query, where, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const $ = (s) => document.querySelector(s);
const CART_KEY = "cart_v1";
const SHARE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>`;

let products = [];
let settings = { shippingFee: 0, freeShippingOver: 0 };
let filter = "Todas";
let cart = loadCart();
let checkoutStep = "cart"; // cart | form

// ---------- Marca ----------
function applyBranding() {
  const words = STORE.name.split(" ");
  const last = words.length > 1 ? words.pop() : "";
  document.querySelectorAll("[data-store-name]").forEach((el) => (el.innerHTML = last ? `${esc(words.join(" "))} <span>${esc(last)}</span>` : esc(STORE.name)));
  document.querySelectorAll("[data-store-plain-name]").forEach((el) => (el.textContent = STORE.name));
  document.querySelectorAll("[data-store-tagline]").forEach((el) => (el.textContent = STORE.tagline));
  document.querySelectorAll("[data-instagram-link]").forEach((el) => (el.href = `https://instagram.com/${STORE.instagram}`));
  document.querySelectorAll("[data-whatsapp-link]").forEach((el) => (el.href = `https://wa.me/${STORE.whatsapp}?text=${encodeURIComponent("Olá! Vi o site e gostaria de encomendar uma bolsa.")}`));
  document.title = `${STORE.name} — ${STORE.tagline}`;
}

// ---------- Dados ----------
async function loadData() {
  try {
    const [snap, st] = await Promise.all([
      getDocs(query(collection(db, "products"), where("active", "==", true))),
      getDoc(doc(db, "settings", "store")),
    ]);
    products = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    products.sort((a, b) => (b.featured === true) - (a.featured === true) || (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    if (st.exists()) settings = { ...settings, ...st.data() };
  } catch (e) {
    console.error(e);
    $("#grid").innerHTML = `<p class="empty">Não foi possível carregar os produtos. Verifique a configuração do Firebase em <code>js/config.js</code>.</p>`;
    return;
  }
  // remove do carrinho itens que não existem mais
  cart = cart.filter((c) => products.some((p) => p.id === c.id));
  saveCart();
  renderChips();
  renderGrid();
  openFromHash();
}

// ---------- Catálogo ----------
function renderChips() {
  const cats = ["Todas", ...new Set(products.map((p) => p.category).filter(Boolean))];
  $("#chips").innerHTML = cats.length > 2 ? cats.map((c) => `<button class="chip ${c === filter ? "active" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("") : "";
}

function renderGrid() {
  const list = filter === "Todas" ? products : products.filter((p) => p.category === filter);
  if (!list.length) { $("#grid").innerHTML = `<p class="empty">Nenhuma peça disponível no momento. Volte em breve!</p>`; return; }
  $("#grid").innerHTML = list.map((p) => `
    <article class="card" data-id="${p.id}">
      <div class="card-media">
        ${p.images?.[0] ? `<img src="${esc(p.images[0])}" alt="${esc(p.name)}" loading="lazy" />` : ""}
        ${p.stock <= 0 ? `<span class="tag sold">Esgotada</span>` : p.stock === 1 ? `<span class="tag">Peça única</span>` : ""}
        <button class="share-fab" data-share="${p.id}" aria-label="Compartilhar">${SHARE_ICON}</button>
      </div>
      <div class="card-body">
        <h3>${esc(p.name)}</h3>
        <div class="price">${brl(p.price)}</div>
      </div>
    </article>`).join("");
}

$("#chips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cat]");
  if (!b) return;
  filter = b.dataset.cat;
  renderChips(); renderGrid();
});

$("#grid").addEventListener("click", (e) => {
  const share = e.target.closest("[data-share]");
  if (share) { e.stopPropagation(); shareProduct(products.find((p) => p.id === share.dataset.share)); return; }
  const card = e.target.closest(".card");
  if (card) openProduct(card.dataset.id);
});

// ---------- Compartilhar (cliente) ----------
async function shareProduct(p) {
  if (!p) return;
  const url = productUrl(p.id);
  const text = `${p.name} — ${brl(p.price)} | ${STORE.name}`;
  if (navigator.share) {
    try { await navigator.share({ title: p.name, text, url }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  await copyText(`${text}\n${url}`);
  toast("Link copiado! Cole no Instagram, WhatsApp…");
}

// ---------- Modal do produto ----------
function openProduct(id) {
  const p = products.find((x) => x.id === id);
  if (!p) return;
  let qty = 1;
  const imgs = p.images?.length ? p.images : [""];
  const sold = p.stock <= 0;
  $("#productContent").innerHTML = `
    <div class="pd">
      <div class="pd-gallery">
        <img class="pd-main" id="pdMain" src="${esc(imgs[0])}" alt="${esc(p.name)}" />
        ${imgs.length > 1 ? `<div class="pd-thumbs">${imgs.map((u, i) => `<img src="${esc(u)}" data-i="${i}" class="${i === 0 ? "active" : ""}" alt="" />`).join("")}</div>` : ""}
      </div>
      <div class="pd-info">
        ${p.category ? `<div class="eyebrow">${esc(p.category)}</div>` : ""}
        <h2>${esc(p.name)}</h2>
        <div class="pd-price">${brl(p.price)}</div>
        <div class="pd-desc">${esc(p.description || "")}</div>
        <dl class="pd-specs" style="margin:0">
          ${p.materials ? `<div><dt>Materiais</dt><dd style="margin:0">${esc(p.materials)}</dd></div>` : ""}
          ${p.dimensions ? `<div><dt>Medidas</dt><dd style="margin:0">${esc(p.dimensions)}</dd></div>` : ""}
          <div><dt>Disponível</dt><dd style="margin:0">${sold ? "Esgotada" : p.stock === 1 ? "Peça única" : `${p.stock} unidades`}</dd></div>
        </dl>
        ${sold ? `<a class="btn ghost" target="_blank" rel="noopener" href="https://wa.me/${STORE.whatsapp}?text=${encodeURIComponent(`Olá! Gostaria de encomendar a bolsa "${p.name}".`)}">Encomendar pelo WhatsApp</a>` : `
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <div class="qty"><button data-q="-1">−</button><span id="pdQty">1</span><button data-q="1">+</button></div>
          <button class="btn accent" id="pdAdd" style="flex:1">Adicionar à sacola</button>
        </div>`}
        <div class="share-row">
          <button class="btn ghost small" id="pdShare">${SHARE_ICON.replace("<svg", '<svg width="16" height="16"')} Compartilhar</button>
          <a class="btn ghost small" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`${p.name} — ${brl(p.price)}\n${productUrl(p.id)}`)}">WhatsApp</a>
          <button class="btn ghost small" id="pdCopy">Copiar link</button>
        </div>
      </div>
    </div>`;
  const box = $("#productContent");
  box.querySelector(".pd-thumbs")?.addEventListener("click", (e) => {
    const t = e.target.closest("img[data-i]");
    if (!t) return;
    $("#pdMain").src = imgs[t.dataset.i];
    box.querySelectorAll(".pd-thumbs img").forEach((im) => im.classList.toggle("active", im === t));
  });
  box.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => {
    qty = Math.min(Math.max(1, qty + Number(b.dataset.q)), p.stock);
    $("#pdQty").textContent = qty;
  }));
  $("#pdAdd")?.addEventListener("click", () => { addToCart(p.id, qty); closeProduct(); openDrawer(); });
  $("#pdShare").addEventListener("click", () => shareProduct(p));
  $("#pdCopy").addEventListener("click", async () => { await copyText(productUrl(p.id)); toast("Link copiado!"); });
  $("#productOverlay").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  history.replaceState(null, "", `#p=${encodeURIComponent(p.id)}`);
}

function closeProduct() {
  $("#productOverlay").classList.add("hidden");
  document.body.style.overflow = "";
  if (location.hash.startsWith("#p=")) history.replaceState(null, "", location.pathname);
}
$("#productOverlay").addEventListener("click", (e) => { if (e.target.id === "productOverlay" || e.target.closest("[data-close]")) closeProduct(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeProduct(); closeDrawer(); } });

function openFromHash() {
  const m = location.hash.match(/^#p=(.+)$/);
  if (m) openProduct(decodeURIComponent(m[1]));
}
window.addEventListener("hashchange", openFromHash);

// ---------- Carrinho ----------
function loadCart() { try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { return []; } }
function saveCart() {
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch {}
  const n = cart.reduce((s, c) => s + c.qty, 0);
  $("#cartCount").textContent = n;
  $("#cartCount").classList.toggle("hidden", n === 0);
}
function addToCart(id, qty) {
  const p = products.find((x) => x.id === id);
  const item = cart.find((c) => c.id === id);
  const current = item ? item.qty : 0;
  const next = Math.min(current + qty, p.stock);
  if (item) item.qty = next; else cart.push({ id, qty: next });
  if (next < current + qty) toast("Quantidade ajustada ao estoque disponível");
  else toast("Adicionado à sacola");
  saveCart();
}
function totals() {
  const subtotal = cart.reduce((s, c) => s + (products.find((p) => p.id === c.id)?.price || 0) * c.qty, 0);
  const free = settings.freeShippingOver > 0 && subtotal >= settings.freeShippingOver;
  const shipping = subtotal > 0 && !free ? Number(settings.shippingFee || 0) : 0;
  return { subtotal, shipping, total: subtotal + shipping };
}

function renderDrawer() {
  const body = $("#drawerBody"), foot = $("#drawerFoot");
  if (!cart.length) {
    checkoutStep = "cart";
    body.innerHTML = `<p class="empty">Sua sacola está vazia.</p>`;
    foot.innerHTML = `<button class="btn block" id="keepShopping">Ver coleção</button>`;
    $("#keepShopping").onclick = () => { closeDrawer(); location.hash = "colecao"; };
    return;
  }
  const t = totals();
  const totalsHtml = `
    <div class="totals">
      <div><span>Subtotal</span><span>${brl(t.subtotal)}</span></div>
      <div><span>Frete</span><span>${t.shipping ? brl(t.shipping) : "Grátis"}</span></div>
      <div class="grand"><span>Total</span><span>${brl(t.total)}</span></div>
    </div>`;

  if (checkoutStep === "cart") {
    $("#drawerTitle").textContent = "Sua sacola";
    body.innerHTML = cart.map((c) => {
      const p = products.find((x) => x.id === c.id);
      return `<div class="cart-item">
        <img src="${esc(p.images?.[0] || "")}" alt="" />
        <div>
          <div class="name">${esc(p.name)}</div>
          <div style="color:var(--muted);font-size:.88rem">${brl(p.price)}</div>
          <button class="link-btn" data-remove="${c.id}">remover</button>
        </div>
        <div class="qty"><button data-dec="${c.id}">−</button><span>${c.qty}</span><button data-inc="${c.id}">+</button></div>
      </div>`;
    }).join("") + (settings.freeShippingOver > 0 && t.shipping ? `<p style="font-size:.85rem;color:var(--olive)">Frete grátis acima de ${brl(settings.freeShippingOver)}</p>` : "");
    foot.innerHTML = totalsHtml + `<button class="btn accent block" id="goCheckout" style="margin-top:12px">Finalizar compra</button>`;
    $("#goCheckout").onclick = () => { checkoutStep = "form"; renderDrawer(); };
  } else {
    $("#drawerTitle").textContent = "Dados para entrega";
    const saved = JSON.parse(localStorage.getItem("customer_v1") || "{}");
    const v = (k) => esc(saved[k] || "");
    body.innerHTML = `
      <button class="link-btn" id="backCart">← voltar para a sacola</button>
      <form class="form" id="checkoutForm" style="margin-top:12px">
        <div class="field"><label>Nome completo*</label><input name="name" required value="${v("name")}" autocomplete="name" /></div>
        <div class="row">
          <div class="field"><label>E-mail*</label><input name="email" type="email" required value="${v("email")}" autocomplete="email" /></div>
          <div class="field"><label>WhatsApp*</label><input name="phone" required value="${v("phone")}" autocomplete="tel" placeholder="(47) 99999-9999" /></div>
        </div>
        <div class="row">
          <div class="field"><label>CEP*</label><input name="cep" required value="${v("cep")}" inputmode="numeric" autocomplete="postal-code" /></div>
          <div class="field"><label>Número*</label><input name="number" required value="${v("number")}" /></div>
        </div>
        <div class="field"><label>Rua*</label><input name="street" required value="${v("street")}" autocomplete="address-line1" /></div>
        <div class="field"><label>Complemento</label><input name="complement" value="${v("complement")}" /></div>
        <div class="row">
          <div class="field"><label>Bairro*</label><input name="district" required value="${v("district")}" /></div>
          <div class="field"><label>Cidade/UF*</label><input name="city" required value="${v("city")}" placeholder="Joinville/SC" /></div>
        </div>
        <div class="field"><label>Observações</label><textarea name="notes" style="min-height:60px">${v("notes")}</textarea></div>
      </form>`;
    foot.innerHTML = totalsHtml + (MODE === "blaze"
      ? `<button class="btn accent block" id="payBtn" style="margin-top:12px">Pagar com Mercado Pago</button>
      <p style="font-size:.78rem;color:var(--muted);text-align:center;margin:8px 0 0">Pix, cartão de crédito (parcelado) ou boleto. Você será levado ao ambiente seguro do Mercado Pago.</p>`
      : `<button class="btn accent block" id="payBtn" style="margin-top:12px">Pagar com Pix</button>
      <p style="font-size:.78rem;color:var(--muted);text-align:center;margin:8px 0 0">Prefere cartão? <a target="_blank" rel="noopener" href="https://wa.me/${STORE.whatsapp}?text=${encodeURIComponent("Olá! Quero comprar pelo site e pagar no cartão.")}">Fale com a gente no WhatsApp</a> e enviamos um link de pagamento.</p>`);
    $("#backCart").onclick = () => { checkoutStep = "cart"; renderDrawer(); };
    const cepInput = body.querySelector('[name="cep"]');
    cepInput.addEventListener("blur", () => fillCep(cepInput.value));
    $("#payBtn").onclick = pay;
  }
}

async function fillCep(cep) {
  const d = cep.replace(/\D/g, "");
  if (d.length !== 8) return;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`);
    const j = await r.json();
    if (j.erro) return;
    const f = $("#checkoutForm");
    if (!f.street.value) f.street.value = j.logradouro || "";
    if (!f.district.value) f.district.value = j.bairro || "";
    if (!f.city.value) f.city.value = `${j.localidade}/${j.uf}`;
  } catch {}
}

async function pay() {
  const f = $("#checkoutForm");
  if (!f.reportValidity()) return;
  const customer = Object.fromEntries(new FormData(f).entries());
  localStorage.setItem("customer_v1", JSON.stringify(customer));
  if (MODE !== "blaze") return payPix(customer);
  const btn = $("#payBtn");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Gerando pagamento…`;
  try {
    const createCheckout = httpsCallable(functions, "createCheckout");
    const { data } = await createCheckout({ items: cart.map((c) => ({ id: c.id, qty: c.qty })), customer });
    localStorage.setItem("last_order", data.orderId);
    window.location.href = data.checkoutUrl;
  } catch (e) {
    console.error(e);
    toast(e.message || "Erro ao iniciar o pagamento. Tente novamente.", 4000);
    btn.disabled = false;
    btn.textContent = "Pagar com Mercado Pago";
  }
}

// ---------- Pix (modo grátis) ----------
async function payPix(customer) {
  if (!PIX.key || !PIX.city) { toast("Pix ainda não configurado na loja. Fale com a gente no WhatsApp.", 4000); return; }
  const btn = $("#payBtn");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Gerando Pix…`;
  const t = totals();
  const items = cart.map((c) => {
    const p = products.find((x) => x.id === c.id);
    return { productId: p.id, name: p.name, price: Number(p.price), qty: c.qty, image: p.images?.[0] || "" };
  });
  const ref = doc(collection(db, "orders"));
  const code = ref.id.slice(0, 8).toUpperCase();
  try {
    await setDoc(ref, {
      code, items, subtotal: t.subtotal, shipping: t.shipping, total: t.total,
      customer, status: "pending", paymentMethod: "pix", createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.error(e);
    toast("Não foi possível registrar o pedido. Tente novamente.", 4000);
    btn.disabled = false; btn.textContent = "Pagar com Pix";
    return;
  }
  const payload = pixPayload({ key: PIX.key, name: PIX.name, city: PIX.city, amount: t.total, txid: code });
  const waText = `Olá! Fiz o pedido ${code} no site (${brl(t.total)}) e paguei via Pix. Segue o comprovante:`;
  cart = []; saveCart();
  checkoutStep = "cart";
  $("#drawerTitle").textContent = "Pague com Pix";
  $("#drawerBody").innerHTML = `
    <div style="text-align:center">
      <p style="margin-top:0">Pedido <strong>${code}</strong> registrado! 🎉<br/>Total: <strong>${brl(t.total)}</strong></p>
      <div style="width:230px;margin:0 auto;background:#fff;padding:8px;border-radius:12px;border:1px solid var(--line)">${qrSvg(payload)}</div>
      <p style="font-size:.88rem;color:var(--muted)">Abra o app do seu banco, escolha <b>Pix &gt; Ler QR Code</b> ou use o <b>copia e cola</b>:</p>
      <textarea readonly id="pixCode" style="width:100%;font-size:.72rem;padding:8px;border:1px solid var(--line);border-radius:10px;min-height:70px">${esc(payload)}</textarea>
      <button class="btn block" id="copyPix" style="margin-top:8px">Copiar código Pix</button>
    </div>`;
  $("#drawerFoot").innerHTML = `
    <a class="btn accent block" target="_blank" rel="noopener" href="https://wa.me/${STORE.whatsapp}?text=${encodeURIComponent(waText)}">Já paguei — enviar comprovante</a>
    <p style="font-size:.78rem;color:var(--muted);text-align:center;margin:8px 0 0">Assim que confirmarmos o Pix, separamos sua bolsa e combinamos o envio pelo WhatsApp.</p>`;
  $("#copyPix").onclick = async () => { await copyText(payload); toast("Código Pix copiado!"); };
}

$("#drawerBody").addEventListener("click", (e) => {
  const id = e.target.dataset.inc || e.target.dataset.dec || e.target.dataset.remove;
  if (!id) return;
  const item = cart.find((c) => c.id === id);
  const p = products.find((x) => x.id === id);
  if (e.target.dataset.inc) item.qty = Math.min(item.qty + 1, p.stock);
  if (e.target.dataset.dec) item.qty -= 1;
  if (e.target.dataset.remove || item.qty <= 0) cart = cart.filter((c) => c.id !== id);
  saveCart(); renderDrawer();
});

function openDrawer() { renderDrawer(); $("#drawer").classList.add("open"); }
function closeDrawer() { $("#drawer").classList.remove("open"); checkoutStep = "cart"; }
$("#cartBtn").addEventListener("click", openDrawer);
$("#drawerClose").addEventListener("click", closeDrawer);

applyBranding();
saveCart();
loadData();
