# CNDs-Automatic (CND-Anty) 🏛️📄

Sistema de automação para emissão em lote, conferência e monitoramento de **Certidões Negativas de Débito (CNDs)** públicas e privadas.

---

## 🚀 Portais Atendidos

1. **Trabalhista (TST / CNDT):** Emissão automática e download de PDF com análise de regularidade.
2. **Caixa Econômica (FGTS / CRF):** Consulta e download do Certificado de Regularidade do FGTS e mapeamento de bloqueios cadastrais.
3. **Federal (Receita Federal / PGFN):** Emissão da Certidão Conjunta de Débitos Relativos a Tributos Federais e à Dívida Ativa da União via consulta pública ou integração autenticada.
4. **Estaduais:**
   - **Paraná (SEFA-PR)**
   - **Maranhão (SEFAZ-MA)** com quebra de CAPTCHA inteligente via Gemini Vision
   - **São Paulo (SEFAZ-SP)**
   - **Espírito Santo (SEFAZ-ES)**
   - **Mato Grosso do Sul (SEFAZ-MS)**
5. **Municipais:**
   - Curitiba, Cascavel, Capanema, Imperatriz/MA, São Paulo (DUC), Arujá, Linhares, São Mateus, Vila Velha, Campo Grande, Osasco, São Bernardo do Campo, Santana de Parnaíba e motores de prefeituras (Betha, IPM, Equiplano, Elotech, Megasoft, e-Pública, EL).

---

## 🛠️ Tecnologias

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, Lucide Icons, Shadcn UI, Supabase Client.
- **Worker (Robô):** Node.js, TypeScript, Playwright, Axios, PDF-Parse, Gemini Vision (API gratuita do Google Gemini para OCR/CAPTCHAs).
- **Backend / Database:** Supabase (PostgreSQL, Storage de PDFs e Autenticação/Row Level Security).
- **Criptografia:** AES-256 para credenciais de prefeituras no banco de dados.

---

## 💻 Como Rodar o Frontend Localmente

1. Instale as dependências:
   ```bash
   npm install
   ```

2. Configure o arquivo `.env` na raiz:
   ```env
   VITE_SUPABASE_URL=sua_url_supabase
   VITE_SUPABASE_ANON_KEY=sua_chave_anon_supabase
   VITE_ENCRYPTION_KEY=sua_chave_aes256
   ```

3. Inicie o servidor Vite:
   ```bash
   npm run dev
   ```

4. Para compilar a versão de produção:
   ```bash
   npm run build
   ```

---

## 🤖 Como Rodar o Worker de Emissão

1. Acesse o diretório `worker`:
   ```bash
   cd worker
   npm install
   ```

2. Configure o arquivo `worker/.env`:
   ```env
   SUPABASE_URL=sua_url_supabase
   SUPABASE_KEY=sua_chave_service_supabase
   GEMINI_API_KEY=sua_chave_gemini_api
   ENCRYPTION_KEY=sua_chave_aes256
   ```

3. Inicie o worker:
   ```bash
   npx tsx src/index.ts
   ```

---

## 🌐 Deploy no Vercel

O frontend está pronto para hospedagem na Vercel:
- **Build Command:** `npm run build`
- **Output Directory:** `dist`
- **Environment Variables:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ENCRYPTION_KEY`
