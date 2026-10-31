import fs from "fs";
import { chromium, Browser, Page } from "playwright";
import { supabase } from "../supabase";
import { analisarCertidaoBuffer } from "../pdf_analyzer";
import { obterCertificadoPrincipal, construirClientCertificates } from "../certs";

export async function processarAruja(
  empresa: { nome: string; cnpj: string },
  credenciaisRaw: string,
  perfilCert?: string
): Promise<{ status: string; resultado: string; pdf_url?: string; mensagem_erro?: string }> {
  console.log(`[ARUJÁ - SP] Iniciando processo para CNPJ: ${empresa.cnpj}`);

  const certAtivo = obterCertificadoPrincipal(perfilCert);
  const hasCert = !!certAtivo;

  // Verifica se o Chrome em Modo Conectado (porta 9222) está disponível
  const cdpRes = await fetch("http://127.0.0.1:9222/json/version").catch(() => null);
  const isCdp = !!(cdpRes && cdpRes.ok);

  if (!credenciaisRaw && !hasCert && !isCdp) {
    return {
      status: "erro",
      resultado: "FALTA LOGIN / ACESSO",
      mensagem_erro: "A Prefeitura de Arujá exige autenticação (Login/Senha na coluna Acesso ou Chrome Conectado com Gov.br)."
    };
  }

  // Divide usuario e senha se vier no formato usuario:senha
  let usuario = credenciaisRaw;
  let senha = "";
  if (credenciaisRaw.includes(":")) {
    const parts = credenciaisRaw.split(":");
    usuario = parts[0] || "";
    senha = parts.slice(1).join(":");
  }

  let browser: any = null;
  let page: Page | null = null;

  try {
    if (isCdp) {
      console.log(`[ARUJÁ] Conectando ao Chrome via CDP na porta 9222...`);
      browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
      const contexts = browser.contexts();
      const context = contexts[0] || browser;
      page = await context.newPage();
    } else {
      console.log(`[ARUJÁ] Iniciando navegador isolado...`);
      browser = await chromium.launch({
        headless: true,
        args: ["--ignore-certificate-errors", "--no-sandbox"]
      });

      let context;
      if (certAtivo) {
        try {
          console.log(`[ARUJÁ] Carregando Certificado Digital A1 (${certAtivo.nome}): ${certAtivo.pfxPath}...`);
          context = await browser.newContext({
            ignoreHTTPSErrors: true,
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            clientCertificates: construirClientCertificates(
              [
                "https://servicos.prefeituradearuja.sp.gov.br",
                "https://certificado.sso.acesso.gov.br",
                "https://sso.acesso.gov.br"
              ],
              certAtivo
            )
          });
        } catch (certLoadErr: any) {
          console.warn(`[ARUJÁ] Erro ao instanciar certificado digital:`, certLoadErr.message);
          context = await browser.newContext({
            ignoreHTTPSErrors: true,
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          });
        }
      } else {
        context = await browser.newContext({
          ignoreHTTPSErrors: true,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        });
      }
      page = await context.newPage();
    }

    if (!page) throw new Error("Não foi possível criar página no navegador.");

    const portalUrl = "https://servicos.prefeituradearuja.sp.gov.br/tbw/loginCNPJContribuinte.jsp?execobj=ContribuintesWebRelacionados";
    console.log(`[ARUJÁ] Acessando portal de serviços: ${portalUrl}...`);
    await page.goto(portalUrl, { timeout: 30000, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // Se tiver credenciais informadas pelo usuário
    if (usuario && senha) {
      const loginInput = page.locator("#usuario, input[name='usuario']").first();
      const passInput = page.locator("#senha, input[name='senha']").first();

      if (await loginInput.count() > 0 && await passInput.count() > 0) {
        console.log(`[ARUJÁ] Realizando autenticação com usuário e senha informados...`);
        await loginInput.fill(usuario);
        await passInput.fill(senha);

        // Se houver captcha de imagem da TBW
        const captchaImg = page.locator("img[src*='captcha'], img[id*='captcha'], img[src*='imagem']").first();
        if (await captchaImg.count() > 0) {
          const buffer = await captchaImg.screenshot().catch(() => null);
          if (buffer) {
            try {
              const { GoogleGenAI } = await import("@google/genai");
              const ai = new GoogleGenAI();
              const res = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: [
                  {
                    role: "user",
                    parts: [
                      { text: "Digite apenas as letras e numeros deste captcha sem espacos." },
                      { inlineData: { data: buffer.toString("base64"), mimeType: "image/png" } }
                    ]
                  }
                ]
              });
              const code = res.text?.trim().replace(/\s/g, "") || "";
              if (code) {
                console.log(`[ARUJÁ] Captcha decodificado com IA: ${code}`);
                await page.locator("input[name='imagem'], #imagem").fill(code);
              }
            } catch (err: any) {
              console.warn(`[ARUJÁ] Falha no captcha com IA:`, err.message);
            }
          }
        }

        const entrarBtn = page.locator("#btnEntrar, a:has-text('Entrar'), button:has-text('Entrar')").first();
        if (await entrarBtn.count() > 0) {
          await entrarBtn.click();
          await page.waitForTimeout(4000);
        }
      }
    } else {
      // Tenta botão de gov.br
      const govBtn = page.locator("button.br-sign-in, button:has-text('gov.br')").first();
      if (await govBtn.count() > 0) {
        console.log(`[ARUJÁ] Tentando autenticação via gov.br / Certificado Digital...`);
        await govBtn.click().catch(() => null);
        await page.waitForTimeout(5000);
      }
    }

    // Acessa emissão de CND
    console.log(`[ARUJÁ] Navegando até certidão negativa e emitindo...`);
    const cnpjInput = page.locator("input[placeholder*='CNPJ'], input[id*='cnpj'], input[name*='cnpj']").first();
    if (await cnpjInput.count() > 0) {
      await cnpjInput.fill(empresa.cnpj.replace(/[^\d]/g, ""));
    }

    const downloadPromise = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
    const emitirBtn = page.locator("button:has-text('Emitir'), a:has-text('Emitir'), input[value*='Emitir']").first();
    if (await emitirBtn.count() > 0) {
      await emitirBtn.click();
    }

    const download = await downloadPromise;
    let pdfUrl: string | undefined = undefined;
    const cleanCnpj = empresa.cnpj.replace(/[^\d]/g, "");

    let resultadoFinal = "PROCESSADO";
    let detalhesFinal: string | undefined = undefined;

    if (download) {
      const fileName = `cnd_municipal_aruja_${cleanCnpj}_${Date.now()}.pdf`;
      const tempPath = await download.path();
      if (tempPath) {
        const pdfBuffer = fs.readFileSync(tempPath);
        const { data: uploadData } = await supabase.storage
          .from("certidoes")
          .upload(fileName, pdfBuffer, { contentType: "application/pdf" });

        if (uploadData) {
          pdfUrl = supabase.storage.from("certidoes").getPublicUrl(fileName).data.publicUrl;
        }

        const analise = await analisarCertidaoBuffer(pdfBuffer, "MUNICIPAL");
        resultadoFinal = analise.resultado;
        detalhesFinal = analise.detalhes;
      }
    } else {
      const pageText = await page.innerText("body").catch(() => "");
      if (pageText.includes("NEGATIVA") || pageText.includes("Certidão Negativa") || pageText.includes("não constam débitos")) {
        const fileName = `cnd_municipal_aruja_${cleanCnpj}_${Date.now()}.pdf`;
        const pdfBuffer = await page.pdf({ format: "A4" }).catch(() => null);
        if (pdfBuffer) {
          const { data: uploadData } = await supabase.storage
            .from("certidoes")
            .upload(fileName, pdfBuffer, { contentType: "application/pdf" });
          if (uploadData) {
            pdfUrl = supabase.storage.from("certidoes").getPublicUrl(fileName).data.publicUrl;
          }
          const analise = await analisarCertidaoBuffer(pdfBuffer, "MUNICIPAL");
          resultadoFinal = analise.resultado;
          detalhesFinal = analise.detalhes;
        }
      } else if (pageText.includes("POSITIVA") || pageText.includes("constam débitos")) {
        return {
          status: "sucesso",
          resultado: "POSITIVA",
          mensagem_erro: "Constam débitos municipais na Prefeitura de Arujá."
        };
      }
    }

    if (!pdfUrl) {
      return {
        status: "erro",
        resultado: "REQUER LOGIN / MODO CONECTADO",
        mensagem_erro: "A Prefeitura de Arujá exige autenticação. Forneça usuário/senha na coluna Acesso da planilha ou use o atalho Iniciar Chrome CND com gov.br."
      };
    }

    return {
      status: "sucesso",
      resultado: resultadoFinal,
      pdf_url: pdfUrl,
      mensagem_erro: detalhesFinal
    };

  } catch (error: any) {
    console.error(`[ARUJÁ] Erro:`, error.message);
    return {
      status: "erro",
      resultado: "ERRO",
      mensagem_erro: `Falha no portal de Arujá: ${error.message}`
    };
  } finally {
    if (page) await page.close().catch(() => null);
    if (!isCdp && browser) await browser.close().catch(() => null);
  }
}
