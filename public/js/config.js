// =====================================================================
//  CONFIGURAÇÃO DA LOJA — edite este arquivo
// =====================================================================

// 1) Cole aqui a configuração do seu app web do Firebase
//    (Console do Firebase > Configurações do projeto > Seus apps > SDK)
export const firebaseConfig = {
  apiKey: "COLE_AQUI",
  authDomain: "SEU-PROJETO.firebaseapp.com",
  projectId: "SEU-PROJETO",
  storageBucket: "SEU-PROJETO.firebasestorage.app",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:xxxxxxxxxxxx",
};

// 2) Dados da loja
export const STORE = {
  name: "Mãos de Mara",
  tagline: "Bolsas feitas à mão, uma a uma",
  instagram: "seu_perfil",          // sem @
  whatsapp: "5547984988380",        // DDI + DDD + número, só dígitos
  email: "contato@sualoja.com.br",
};

// 3) Plano do Firebase
//    "spark" = grátis: pagamento por Pix (você confirma no painel), fotos no Cloudinary
//    "blaze" = pago por uso: Mercado Pago automático, fotos no Firebase Storage, Instagram automático
export const MODE = "spark";

// 4) Pix (usado no modo "spark")
export const PIX = {
  key: "",               // sua chave Pix: CPF/CNPJ só números, e-mail, +55DDDNUMERO ou chave aleatória
  name: "Maos de Mara",  // nome de quem recebe (até 25 letras)
  city: "",              // cidade de quem recebe (até 15 letras), ex.: "Joinville"
};

// 5) Cloudinary — hospedagem grátis das fotos (usado no modo "spark")
//    Crie a conta em cloudinary.com e um "upload preset" do tipo Unsigned (veja o README)
export const CLOUDINARY = {
  cloudName: "",
  uploadPreset: "",
};

// Região das Cloud Functions (São Paulo) — só no modo "blaze"
export const FUNCTIONS_REGION = "southamerica-east1";
