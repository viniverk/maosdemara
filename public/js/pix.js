// Gera o código Pix "copia e cola" (BR Code estático, padrão do Banco Central)

const tlv = (id, value) => id + String(value.length).padStart(2, "0") + value;

const plain = (s, max) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 .\-]/g, "").toUpperCase().trim().slice(0, max);

export function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * @param {object} p
 * @param {string} p.key   chave Pix (CPF/CNPJ só dígitos, e-mail, +55DDDNUMERO ou chave aleatória)
 * @param {string} p.name  nome do recebedor (até 25 letras)
 * @param {string} p.city  cidade do recebedor (até 15 letras)
 * @param {number} p.amount valor em reais
 * @param {string} p.txid  identificador do pedido (até 25 letras/números)
 * @param {string} [p.message] mensagem curta
 */
export function pixPayload({ key, name, city, amount, txid, message }) {
  const account = tlv("00", "br.gov.bcb.pix") + tlv("01", key.trim()) + (message ? tlv("02", plain(message, 40)) : "");
  const payload =
    tlv("00", "01") +
    tlv("26", account) +
    tlv("52", "0000") +
    tlv("53", "986") +
    (amount ? tlv("54", Number(amount).toFixed(2)) : "") +
    tlv("58", "BR") +
    tlv("59", plain(name, 25) || "LOJA") +
    tlv("60", plain(city, 15) || "BRASIL") +
    tlv("62", tlv("05", String(txid || "***").replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***")) +
    "6304";
  return payload + crc16(payload);
}

/** Desenha o QR Code (usa a biblioteca carregada em js/vendor/qrcode.js) e devolve o SVG. */
export function qrSvg(text) {
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}
