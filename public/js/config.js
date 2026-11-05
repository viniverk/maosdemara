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
  whatsapp: "5547999999999",        // DDI + DDD + número, só dígitos
  email: "contato@sualoja.com.br",
};

// Região das Cloud Functions (São Paulo)
export const FUNCTIONS_REGION = "southamerica-east1";
