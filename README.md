# 👜 Mãos de Mara — Bolsas Artesanais

Loja online completa com **vitrine**, **sacola de compras**, **pagamento pelo Mercado Pago** (Pix, cartão parcelado e boleto), **painel de administração** e **compartilhamento no Instagram**.

Tecnologias: HTML + CSS + JavaScript puro (sem build), **Firebase** (Hosting, Firestore, Storage, Auth, Cloud Functions) e **GitHub** (código + deploy automático).

---

## 📁 Estrutura

```
public/                 ← o site (vai para o Firebase Hosting)
  index.html            ← vitrine + sacola + checkout
  pedido.html           ← página de retorno do pagamento
  admin.html            ← painel (produtos, pedidos, Instagram, configurações)
  css/style.css
  js/config.js          ← ⚠️ EDITE: dados do Firebase e da loja
  js/store.js | admin.js | firebase.js | utils.js
functions/              ← backend (Cloud Functions)
  index.js              ← checkout Mercado Pago, webhook, publicação no Instagram
  .env.example          ← copie para .env
firestore.rules         ← segurança do banco
storage.rules           ← segurança das fotos
cors.json               ← libera o download das fotos (botão do Instagram)
.github/workflows/deploy.yml ← deploy automático do site a cada push
```

---

## 🆓 Começando no plano grátis (Spark) — modo atual

O site está configurado com `MODE = "spark"` em `public/js/config.js`. Nesse modo **não precisa de cartão** e funciona assim:

| | Grátis (Spark) | Depois, no Blaze |
|---|---|---|
| Pagamento | **Pix**: o site gera o QR Code e o “copia e cola” com o valor do pedido; a cliente envia o comprovante pelo WhatsApp e **você confirma no painel** | Mercado Pago automático (Pix, cartão, boleto) |
| Cartão | A cliente chama no WhatsApp e você manda um link de pagamento do Mercado Pago | Automático |
| Estoque | Baixa sozinho quando **você** marca o pedido como **pago** | Baixa sozinho quando o pagamento é aprovado |
| Fotos | **Cloudinary** (grátis) ou link de imagem | Firebase Storage |
| Instagram | Compartilhar no app + baixar fotos | + publicação automática |

### Passo a passo no modo grátis
1. **Firebase** (sem cartão): crie o projeto `maosdemara`; ative **Authentication → E-mail/senha** (e crie seu usuário) e **Firestore** (região `southamerica-east1`). **Não** ative Storage nem Functions. Copie o `firebaseConfig` para `public/js/config.js`.
2. **Pix**: em `config.js`, preencha `PIX.key` (sua chave), `PIX.name` e `PIX.city`.
3. **Cloudinary** (fotos): crie conta grátis em <https://cloudinary.com>. No painel, copie o **Cloud name**. Vá em ⚙️ *Settings → Upload → Upload presets → Add upload preset*, mude **Signing mode** para **Unsigned**, salve e copie o nome do preset. Preencha `CLOUDINARY.cloudName` e `CLOUDINARY.uploadPreset` no `config.js`.
   *(Alternativa sem Cloudinary: suba as fotos na pasta `public/img/produtos/` pelo GitHub e, no painel, use “cole o link de uma foto” com `https://SEU-SITE/img/produtos/nome.jpg`.)*
4. **Publicar**:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase deploy        # publica o site e as regras do Firestore
   ```
5. **Admin**: entre em `/admin.html`, copie o ID mostrado e crie o documento em `admins/<ID>` no Firestore (passo 7 abaixo).
6. **Rotina de vendas**: chegou comprovante no WhatsApp → painel → **Pedidos** → confira o valor no banco → mude para **pago** → salve. Depois **enviado** + código de rastreio.

> 🔒 No modo grátis a cliente registra o pedido direto no banco. Por isso **sempre confira no app do banco** se o valor recebido é o total do pedido antes de marcar como pago (o painel mostra esse lembrete).

### Quando quiser mudar para o Blaze
Mude `MODE` para `"blaze"` no `config.js`, siga as seções abaixo (Mercado Pago, segredos, CORS) e publique com:
```bash
firebase deploy --config firebase.blaze.json
```
(O `firebase.blaze.json` inclui Functions, Storage e o webhook do Mercado Pago.)

---

## 🚀 Passo a passo no plano Blaze (completo)

### 1. Criar o projeto no Firebase
1. Acesse <https://console.firebase.google.com> → **Adicionar projeto** → nome **`maosdemara`** (se o ID estiver ocupado, o Firebase sugere outro, ex. `maosdemara-1a2b3`; nesse caso troque também em `.firebaserc`).
2. Mude para o plano **Blaze** (pago por uso). As Cloud Functions exigem isso, mas uma loja pequena costuma ficar **dentro da cota gratuita**. Dica: configure um **alerta de orçamento** (ex.: R$ 20) no Google Cloud.
3. Ative os serviços:
   - **Authentication** → Método de login → **E-mail/senha**. Depois, em *Usuários*, **adicione o seu usuário** (o e-mail e a senha que você vai usar no painel).
   - **Firestore Database** → Criar banco → região **southamerica-east1 (São Paulo)** → modo produção.
   - **Storage** → Começar → região **us-east1** (fica dentro da cota gratuita).
4. Em ⚙️ **Configurações do projeto → Seus apps → Web (`</>`)**, registre um app e copie o objeto `firebaseConfig`.

### 2. Configurar o código
1. Abra `public/js/config.js` e cole o `firebaseConfig`. Ajuste **nome da loja, Instagram e WhatsApp**.
2. O `.firebaserc` já está com `maosdemara`; só troque se o ID do seu projeto for diferente.
3. Copie `functions/.env.example` para `functions/.env` e preencha `SITE_URL` (ex.: `https://maosdemara.web.app`).

### 3. Instalar as ferramentas (uma vez)
Instale o [Node.js 22](https://nodejs.org) e depois, no terminal, dentro da pasta do projeto:

```bash
npm install -g firebase-tools
firebase login
cd functions && npm install && cd ..
```

### 4. Mercado Pago
1. Crie/acesse sua conta em <https://www.mercadopago.com.br/developers/panel> → **Suas integrações → Criar aplicação** (tipo *Pagamentos online / Checkout Pro*).
2. Copie o **Access Token**. Comece com o de **teste** (`TEST-...`) e depois troque pelo de **produção** (`APP_USR-...`).
3. Salve como segredo no Firebase:
   ```bash
   firebase functions:secrets:set MP_ACCESS_TOKEN
   ```
4. Instagram automático ainda não? Crie o segredo com um valor qualquer para o deploy não reclamar:
   ```bash
   firebase functions:secrets:set IG_ACCESS_TOKEN   # digite: nao-configurado
   ```

### 5. Publicar
```bash
firebase deploy --config firebase.blaze.json
```
Isso publica o site, as regras de segurança e as funções. O endereço aparece no final (ex.: `https://meu-projeto.web.app`).

### 6. Liberar as fotos para o botão do Instagram (CORS)
O painel baixa as fotos para enviá-las ao app do Instagram. Rode uma vez (o comando `gsutil` vem com o [Google Cloud SDK](https://cloud.google.com/sdk), ou use o **Cloud Shell** no console do Google Cloud):
```bash
gsutil cors set cors.json gs://SEU-PROJETO.appspot.com
```
(Use o nome do bucket que aparece na aba Storage — pode terminar em `.firebasestorage.app`.)

### 7. Tornar-se administrador
1. Acesse `https://SEU-SITE/admin.html` e entre com o usuário criado no passo 1.
2. O painel vai mostrar o seu **ID**. No Firestore, crie a coleção **`admins`** e um documento com **esse ID** (sem campos).
3. Recarregue. Pronto! 🎉 Cadastre as bolsas e defina o frete em **Configurações**.

---

## 💳 Como funciona o pagamento
1. A cliente monta a sacola e preenche os dados de entrega (o CEP preenche o endereço automaticamente).
2. A função `createCheckout` **recalcula o preço pelo banco** (ninguém consegue alterar o valor pelo navegador), confere o estoque, cria o pedido e gera o link do **Checkout Pro**.
3. A cliente paga no Mercado Pago (Pix, cartão em até 6x ou boleto) e volta para `pedido.html`.
4. O Mercado Pago avisa o site em `/api/mp-webhook`. A função **confere o pagamento direto na API do Mercado Pago**, marca o pedido como **pago** e **baixa o estoque**. Se houver estorno, o estoque volta.
5. No painel → **Pedidos**: veja os pagos, marque como *enviado*, informe o rastreio e chame a cliente no WhatsApp.

**Testar:** use o Access Token de teste e os [cartões de teste](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/additional-content/your-integrations/test/cards) do Mercado Pago, entrando no checkout com uma **conta de comprador de teste**.

---

## 📸 Instagram — 3 formas
No painel, cada produto tem o botão **Instagram**, que gera a legenda automaticamente (nome, descrição, preço, link e hashtags):

| Opção | Onde funciona | Configuração |
|---|---|---|
| **📱 Compartilhar no app** | Celular (Android/iPhone) | Nenhuma além do passo 6. Copia a legenda e abre o menu de compartilhar → escolha Instagram (Feed ou Stories) e cole a legenda. |
| **⬇️ Baixar fotos + copiar legenda** | Computador | Nenhuma. |
| **⚡ Publicar automaticamente** | Qualquer lugar | Precisa da API oficial (abaixo). Publica foto única ou carrossel (até 10 fotos). |

Na vitrine, as clientes também têm um **botão de compartilhar em cada foto** (link do produto para Instagram, WhatsApp etc.). O link abre a loja já com aquela bolsa aberta.

### Configurar a publicação automática (opcional)
1. Transforme o Instagram da loja em **conta profissional** (Comercial ou Criador de conteúdo).
2. Em <https://developers.facebook.com/apps>, crie um app → adicione o produto **Instagram** → **API com login do Instagram**.
3. Em *Gerar tokens de acesso*, adicione sua conta e gere o token (permissões `instagram_business_basic` e `instagram_business_content_publish`). Anote também o **ID da conta do Instagram**.
4. Configure:
   ```bash
   firebase functions:secrets:set IG_ACCESS_TOKEN   # cole o token
   ```
   E no `functions/.env`: `IG_USER_ID=<id da conta>`.
5. `firebase deploy --only functions`

> ⚠️ O token de longa duração vale **60 dias**. Renove antes de vencer (no painel da Meta ou pela API `refresh_access_token`) e rode o `secrets:set` de novo.
> Se preferir o login pelo Facebook (conta ligada a uma Página), use `IG_API_HOST=https://graph.facebook.com`.

---

## 🔁 GitHub + deploy automático
1. Crie o repositório **`maosdemara`** no GitHub (pode ser privado) e envie o código:
   ```bash
   git init && git add . && git commit -m "Loja Mãos de Mara"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/maosdemara.git
   git push -u origin main
   ```
   O arquivo `functions/.env` **não** vai para o GitHub (está no `.gitignore`).
2. Para o site publicar sozinho a cada `git push`:
   ```bash
   firebase init hosting:github
   ```
   Esse comando cria o segredo `FIREBASE_SERVICE_ACCOUNT` no GitHub automaticamente. Depois, em *Settings → Secrets and variables → Actions → Variables*, crie `FIREBASE_PROJECT_ID` com o ID do projeto. (Se o comando gerar workflows próprios, pode apagar os dele e ficar só com `deploy.yml`.)
3. Mudanças nas **functions** continuam com `firebase deploy --only functions`.

---

## ✍️ Personalizar
- **Cores e fontes:** topo de `public/css/style.css` (variáveis `--accent`, `--bg` etc.).
- **Textos do site:** `public/index.html` (título, “Sobre”, rodapé).
- **Parcelas máximas:** `installments` em `functions/index.js`.
- **Domínio próprio** (ex.: `www.sualoja.com.br`): Firebase Hosting → *Adicionar domínio personalizado*. Depois atualize `SITE_URL` e rode `firebase deploy --only functions`.

## ❓ Problemas comuns
- **"Não foi possível carregar os produtos"** → confira `config.js` e se o Firestore foi criado.
- **Botão de pagar dá erro** → veja `firebase functions:log`. Geralmente é o `MP_ACCESS_TOKEN` ou o `SITE_URL`.
- **Pedido não muda para “pago”** → o `SITE_URL` precisa ser o endereço publicado (o Mercado Pago chama `SITE_URL/api/mp-webhook`).
- **“Compartilhar (disponível no celular)” cinza** → normal no computador. No celular, se continuar cinza, refaça o passo 6 (CORS).
- **Duas pessoas pagaram a última peça ao mesmo tempo** → raro, mas o estoque pode ficar negativo. O pedido aparece no painel; combine com a cliente uma encomenda ou faça o estorno pelo Mercado Pago.
