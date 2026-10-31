import { chromium } from "playwright";
import { supabase } from "../supabase";
import axios from "axios";
import { analisarCertidaoBuffer } from "../pdf_analyzer";

export async function processarEstadualES(cnpj: string): Promise<{
  status: string;
  resultado: string;
  pdf_url?: string;
  mensagem_erro?: string;
}> {
  console.log(`[ESTADUAL-ES] Iniciando emissão para CNPJ: ${cnpj}`);
  const cleanCnpj = cnpj.replace(/\D/g, "");

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
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    });
    const page = await context.newPage();

    console.log(`[ESTADUAL-ES] Acessando portal da SEFAZ-ES...`);
    await page.goto("https://s2-internet.sefaz.es.gov.br/certidao/cnd", {
      waitUntil: "domcontentloaded",
      timeout: 35000
    });
    await page.waitForTimeout(2500);

    // Clica no link/menu 'Certidão Negativa de Débito'
    const menuLink = page.locator("text=Certidão Negativa de Débito");
    if (await menuLink.count() > 0) {
      await menuLink.first().click();
      await page.waitForTimeout(2000);
    }

    // Preenche CNPJ
    const inputIdent = page.locator("#numIdentificacao");
    await inputIdent.waitFor({ state: "visible", timeout: 10000 });
    await inputIdent.fill(cleanCnpj);
    await page.waitForTimeout(1000);

    // Resolve Cloudflare Turnstile com CapMonster se disponível
    const capmonsterKey = process.env.CAPMONSTER_API_KEY;
    if (capmonsterKey && capmonsterKey !== "cole_aqui_a_chave_do_capmonster") {
      try {
        console.log(`[ESTADUAL-ES] Solicitando resolução de Cloudflare Turnstile ao CapMonster...`);
        const taskRes = await axios.post("https://api.capmonster.cloud/createTask", {
          clientKey: capmonsterKey,
          task: {
            type: "TurnstileTaskProxyless",
            websiteURL: "https://s2-internet.sefaz.es.gov.br/certidao/cnd",
            websiteKey: "0x4AAAAAAB4i1okB7ECebDlO"
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
              const token = check.data.solution?.token;
              if (token) {
                console.log(`[ESTADUAL-ES] Turnstile resolvido! Injetando token...`);
                await page.evaluate((t) => {
                  const input = document.querySelector('input[name="cf-turnstile-response"]') as HTMLInputElement;
                  if (input) input.value = t;
                  if (typeof (window as any).onTurnstileSuccess === "function") {
                    (window as any).onTurnstileSuccess(t);
                  }
                }, token);
              }
              break;
            }
          }
        }
      } catch (err: any) {
        console.log(`[ESTADUAL-ES] Aviso Turnstile (seguindo):`, err.message);
      }
    }

    console.log(`[ESTADUAL-ES] Clicando em 'Emitir Certidão'...`);
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 8000 }).catch(() => null),
      page.click("#btn-emitir-certidao")
    ]);

    await page.waitForTimeout(5000);
    const bodyText = await page.innerText("body");

    // Verifica erros ou alertas
    if (bodyText.includes("Complete a verificação de segurança")) {
      return {
        status: "erro",
        resultado: "DESAFIO TURNSTILE",
        mensagem_erro: "Validação Cloudflare Turnstile pendente na SEFAZ-ES. Requer CapMonster."
      };
    }

    if (bodyText.includes("não foi possível") || bodyText.includes("Constam débitos") || bodyText.includes("irregularidade")) {
      return {
        status: "sucesso",
        resultado: "POSITIVA",
        mensagem_erro: "Constam débitos ou pendências tributárias na SEFAZ-ES."
      };
    }

    if (bodyText.includes("Certidão Negativa") || bodyText.includes("CERTIDÃO NEGATIVA") || download) {
      let pdfBuffer: Buffer;
      if (download) {
        const path = await download.path();
        pdfBuffer = require("fs").readFileSync(path);
      } else {
        pdfBuffer = await page.pdf({ format: "A4" });
      }

      const fileName = `cnd_estadual_es_${cleanCnpj}_${Date.now()}.pdf`;
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
    }

    return {
      status: "sucesso",
      resultado: "PROCESSADO",
      mensagem_erro: "Consulta concluída na SEFAZ-ES."
    };

  } catch (error: any) {
    console.error(`[ESTADUAL-ES] Erro:`, error.message);
    return {
      status: "erro",
      resultado: "ERRO",
      mensagem_erro: `Falha no portal SEFAZ-ES: ${error.message}`
    };
  } finally {
    await browser.close();
  }
}
