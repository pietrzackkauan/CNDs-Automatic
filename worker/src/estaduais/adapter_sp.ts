import { chromium } from "playwright";
import { supabase } from "../supabase";
import axios from "axios";
import { analisarCertidaoBuffer } from "../pdf_analyzer";
import { obterCertificadoPrincipal, construirClientCertificates } from "../certs";

export async function processarEstadualSP(cnpj: string, perfilCert?: string): Promise<{
  status: string;
  resultado: string;
  pdf_url?: string;
  mensagem_erro?: string;
}> {
  console.log(`[ESTADUAL-SP] Iniciando processo para o CNPJ: ${cnpj}`);
  const cleanCnpj = cnpj.replace(/\D/g, "");

  // =========================================================================
  // OPÇÃO 1: Autenticação direta com Certificado Digital A1 (.pfx / .p12)
  // =========================================================================
  const certAtivo = obterCertificadoPrincipal(perfilCert);

  if (certAtivo) {
    console.log(`[ESTADUAL-SP] Certificado Digital A1 (${certAtivo.nome}) localizado em: ${certAtivo.pfxPath}`);

      const browser = await chromium.launch({
        headless: true,
        args: [
          "--ignore-certificate-errors",
          "--no-sandbox",
          "--disable-blink-features=AutomationControlled"
        ]
      });

      try {
        const context = await browser.newContext({
          ignoreHTTPSErrors: true,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          clientCertificates: construirClientCertificates(
            [
              "https://certificado.sso.acesso.gov.br",
              "https://sso.acesso.gov.br",
              "https://idp.sp.gov.br",
              "https://www4.fazenda.sp.gov.br"
            ],
            certAtivo
          )
        });

        const page = await context.newPage();

        console.log(`[ESTADUAL-SP] Acessando portal SIDEB (Fazenda SP)...`);
        await page.goto("https://www4.fazenda.sp.gov.br/SIDEB/CertidaoNegativaDebitos", {
          waitUntil: "domcontentloaded",
          timeout: 35000
        });
        await page.waitForTimeout(3000);

        console.log(`[ESTADUAL-SP] Clicando em 'Emitir eCND'...`);
        const emitirBtn = page.locator('button:has-text("Emitir eCND"), a:has-text("Emitir eCND")');
        if (await emitirBtn.count() > 0) {
          await emitirBtn.first().click();
          await page.waitForTimeout(4000);
        }

        // Se estiver na tela do Gov.br
        if (page.url().includes("gov.br")) {
          console.log(`[ESTADUAL-SP] Tela Gov.br identificada. Preparando resolução de segurança...`);

          // Gov.br exige hCaptcha invisível antes do submit do certificado
          const capmonsterKey = process.env.CAPMONSTER_API_KEY;
          if (capmonsterKey && capmonsterKey !== "cole_aqui_a_chave_do_capmonster") {
            try {
              console.log(`[ESTADUAL-SP] Solicitando token hCaptcha do Gov.br ao CapMonster...`);
              const taskRes = await axios.post("https://api.capmonster.cloud/createTask", {
                clientKey: capmonsterKey,
                task: {
                  type: "HCaptchaTaskProxyless",
                  websiteURL: page.url(),
                  websiteKey: "93b08d40-d46c-400a-ba07-6f91cda815b9"
                }
              });

              if (taskRes.data.taskId) {
                const taskId = taskRes.data.taskId;
                for (let i = 0; i < 20; i++) {
                  await new Promise((r) => setTimeout(r, 2000));
                  const check = await axios.post("https://api.capmonster.cloud/getTaskResult", {
                    clientKey: capmonsterKey,
                    taskId
                  });
                  if (check.data.status === "ready") {
                    const token = check.data.solution?.gRecaptchaResponse;
                    if (token) {
                      console.log(`[ESTADUAL-SP] Token hCaptcha obtido! Submetendo formulário com certificado...`);
                      await page.evaluate((t) => {
                        const form = document.getElementById("loginData") as HTMLFormElement;
                        const btn = document.getElementById("login-certificate") as HTMLButtonElement;
                        const op = document.getElementById("operation-field") as HTMLInputElement;
                        if (op) {
                          op.setAttribute("name", "operation");
                          op.setAttribute("value", "login-certificate");
                        }
                        if (btn && form) {
                          form.action = btn.getAttribute("formaction") || form.action;
                        }
                        const textareas = document.querySelectorAll('textarea[name="h-captcha-response"], input[name="h-captcha-response"]');
                        textareas.forEach((el: any) => el.value = t);
                        if (typeof (window as any).onHcaptchaCallback === "function") {
                          (window as any).onHcaptchaCallback(t);
                        } else if (form) {
                          form.submit();
                        }
                      }, token);
                    }
                    break;
                  }
                }
              }
            } catch (captchaErr: any) {
              console.log(`[ESTADUAL-SP] Aviso na resolução hCaptcha:`, captchaErr.message);
            }
          } else {
            // Tenta clique direto caso passe de forma invisível
            const certBtn = page.locator("#login-certificate");
            if (await certBtn.count() > 0) {
              await certBtn.first().click();
            }
          }

          console.log(`[ESTADUAL-SP] Aguardando redirecionamento pós-login...`);
          await page.waitForTimeout(8000);
        }

        console.log(`[ESTADUAL-SP] Página pós-autenticação: ${page.url()}`);

        // Busca campo de preenchimento de CNPJ da empresa alvo dentro do SIDEB
        const cnpjInput = page.locator("input[placeholder*='CNPJ'], input[name*='cnpj'], input[id*='cnpj'], input[type='text']").first();
        if (await cnpjInput.count() > 0) {
          console.log(`[ESTADUAL-SP] Preenchendo CNPJ da empresa (${cleanCnpj})...`);
          await cnpjInput.fill(cleanCnpj);
          await page.waitForTimeout(1000);

          const submitBtn = page.locator("button[type='submit'], button:has-text('Emitir'), button:has-text('Consultar'), button:has-text('Pesquisar')").first();
          if (await submitBtn.count() > 0) {
            await submitBtn.click();
            await page.waitForTimeout(6000);
          }
        }

        const bodyText = await page.innerText("body");
        const isNegativa = bodyText.includes("Certidão Negativa") || bodyText.includes("não constam débitos") || bodyText.includes("NEGATIVA");
        const isPositiva = bodyText.includes("Positiva") || bodyText.includes("constam débitos") || bodyText.includes("pendência");

        if (isNegativa || (!isPositiva && bodyText.includes("CERTIDÃO"))) {
          console.log(`[ESTADUAL-SP] Certidão emitida com sucesso! Gerando PDF...`);
          const fileName = `cnd_estadual_sp_${cleanCnpj}_${Date.now()}.pdf`;
          const pdfBuffer = await page.pdf({ format: "A4" });

          const { data: uploadData, error: uploadError } = await supabase.storage
            .from("certidoes")
            .upload(fileName, pdfBuffer, { contentType: "application/pdf" });

          let pdfUrl = undefined;
          if (!uploadError && uploadData) {
            pdfUrl = supabase.storage.from("certidoes").getPublicUrl(fileName).data.publicUrl;
          }

          const analise = await analisarCertidaoBuffer(pdfBuffer, "ESTADUAL");

          return {
            status: "sucesso",
            resultado: analise.resultado,
            pdf_url: pdfUrl,
            mensagem_erro: analise.detalhes || undefined
          };
        } else if (isPositiva) {
          return {
            status: "sucesso",
            resultado: "POSITIVA",
            mensagem_erro: "Constam débitos tributários inscritos ou não inscritos no Estado de SP."
          };
        }

        return {
          status: "sucesso",
          resultado: "PROCESSADO",
          mensagem_erro: "Consulta realizada com Certificado Digital no SIDEB-SP."
        };

      } catch (err: any) {
        console.error(`[ESTADUAL-SP] Erro com Certificado Digital:`, err.message);
        return {
          status: "erro",
          resultado: "ERRO CERTIFICADO",
          mensagem_erro: `Falha na autenticação por Certificado A1: ${err.message}`
        };
      } finally {
        await browser.close();
      }
  } else {
    console.warn(`[ESTADUAL-SP] Nenhum Certificado Digital A1 localizado.`);
  }

  // =========================================================================
  // OPÇÃO 2: Fallback via API (Infosimples / Prodesp) se configurado
  // =========================================================================
  const infosimplesToken = process.env.INFOSIMPLES_API_TOKEN;
  if (infosimplesToken && infosimplesToken !== "cole_aqui_seu_token") {
    try {
      console.log(`[ESTADUAL-SP] Enviando requisição para API Sefaz-SP (Infosimples)...`);
      const response = await axios.post(
        "https://api.infosimples.com/api/v2/consultas/sefaz/sp/certidao-negativa-debitos",
        { token: infosimplesToken, cnpj: cleanCnpj, timeout: 300 },
        { timeout: 60000 }
      );
      const data = response.data;
      if (data.code === 200 && data.data && data.data.length > 0) {
        const item = data.data[0];
        const resultadoTexto = String(item.resultado || item.status || "").toUpperCase();
        const pdfUrlOriginal = item.site_receipt || item.certidao_pdf_url;
        let pdfUrlFinal = pdfUrlOriginal;

        if (pdfUrlOriginal) {
          try {
            const pdfResp = await axios.get(pdfUrlOriginal, { responseType: "arraybuffer" });
            const fileName = `cnd_estadual_sp_${cleanCnpj}_${Date.now()}.pdf`;
            const { data: uploadData } = await supabase.storage
              .from("certidoes")
              .upload(fileName, Buffer.from(pdfResp.data), { contentType: "application/pdf" });
            if (uploadData) {
              pdfUrlFinal = supabase.storage.from("certidoes").getPublicUrl(fileName).data.publicUrl;
            }
          } catch (e: any) {
            console.log(`[ESTADUAL-SP] Aviso ao espelhar PDF no Supabase:`, e.message);
          }
        }

        const isNegativa = resultadoTexto.includes("NEGATIVA") || !resultadoTexto.includes("POSITIVA");
        return {
          status: "sucesso",
          resultado: isNegativa ? "NEGATIVA" : "POSITIVA",
          pdf_url: pdfUrlFinal,
          mensagem_erro: isNegativa ? undefined : (item.mensagem || "Constam débitos tributários no Estado de SP.")
        };
      }
    } catch (err: any) {
      console.error(`[ESTADUAL-SP] Falha na chamada da API:`, err.message);
    }
  }

  // Se nada foi configurado:
  return {
    status: "erro",
    resultado: "AGUARDANDO CERTIFICADO OU API (SP)",
    mensagem_erro: "Configure SP_CERT_PATH e SP_CERT_PASS no worker/.env para emitir CNDs de São Paulo com Certificado A1."
  };
}
