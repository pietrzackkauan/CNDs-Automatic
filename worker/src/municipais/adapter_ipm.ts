import { chromium } from "playwright";
import { supabase } from "../supabase";
import { analisarCertidaoBuffer } from "../pdf_analyzer";
import axios from "axios";
import fs from "fs";

export async function processarIPM(
  empresa: { nome: string; cnpj: string },
  cidadeConfig: { nomeOficial: string; uf: string; url: string }
): Promise<{ status: string; resultado: string; pdf_url?: string; mensagem_erro?: string }> {
  console.log(`[IPM - ${cidadeConfig.nomeOficial}] Iniciando emissão para CNPJ: ${empresa.cnpj}`);

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    
    // Constrói URL direta do serviço 31 (Certidão de Débitos)
    const slug = cidadeConfig.nomeOficial.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "");
    const targetUrl = `https://${slug}.atende.net/#!/tipo/servico/valor/31/padrao/1/load/0`;

    console.log(`[IPM] Acessando portal: ${targetUrl}`);
    await page.goto(targetUrl, { timeout: 35000, waitUntil: "load" });
    await page.waitForTimeout(4000);

    // Fecha banner de cookies se existir
    const aceitarCookies = page.locator(".btn-aceitar-cookies, button:has-text('Aceitar')").first();
    if (await aceitarCookies.count() > 0) {
      await aceitarCookies.click().catch(() => {});
    }

    // Seleciona pessoa jurídica se houver rádio/select
    const pjRadio = page.locator("input[value*='JURIDICA'], input[value*='ECONOMICO'], label:has-text('Jurídica')").first();
    if (await pjRadio.count() > 0) {
      await pjRadio.click().catch(() => {});
    }

    // Preenche CNPJ
    const cnpjInput = page.locator("input[name*='cnpj'], input[id*='cnpj'], input[placeholder*='CNPJ'], input[type='text']").first();
    if (await cnpjInput.count() > 0) {
      await cnpjInput.fill(empresa.cnpj.replace(/[^\d]/g, ""));
    }

    // Verifica se há reCAPTCHA
    const recaptchaElement = page.locator(".g-recaptcha, iframe[src*='recaptcha']").first();
    if (await recaptchaElement.count() > 0) {
      console.log(`[IPM] reCAPTCHA detectado. Verificando CapMonster...`);
      const capmonsterKey = process.env.CAPMONSTER_API_KEY;
      if (capmonsterKey && capmonsterKey !== "cole_aqui_a_chave_do_capmonster") {
        // Obter sitekey
        const siteKey = await page.getAttribute(".g-recaptcha", "data-sitekey").catch(() => "6Ld-example");
        if (siteKey) {
          const taskRes = await axios.post("https://api.capmonster.cloud/createTask", {
            clientKey: capmonsterKey,
            task: {
              type: "NoCaptchaTaskProxyless",
              websiteURL: page.url(),
              websiteKey: siteKey
            }
          });
          if (taskRes.data.errorId === 0) {
            const taskId = taskRes.data.taskId;
            for (let i = 0; i < 20; i++) {
              await new Promise(r => setTimeout(r, 3000));
              const res = await axios.post("https://api.capmonster.cloud/getTaskResult", {
                clientKey: capmonsterKey,
                taskId: taskId
              });
              if (res.data.status === "ready") {
                const token = res.data.solution.gRecaptchaResponse;
                await page.evaluate((t) => {
                  const area = document.querySelector("#g-recaptcha-response") as HTMLTextAreaElement;
                  if (area) area.value = t;
                }, token);
                break;
              }
            }
          }
        }
      }
    }

    console.log(`[IPM] Clicando em Emitir...`);
    const emitirBtn = page.locator("button:has-text('Emitir'), button:has-text('Consultar'), .btn-emitir").first();
    const downloadPromise = page.waitForEvent("download", { timeout: 20000 }).catch(() => null);

    if (await emitirBtn.count() > 0) {
      await emitirBtn.click();
    }

    const download = await downloadPromise;
    if (download) {
      console.log(`[IPM] PDF capturado! Enviando para o Supabase...`);
      const tempPath = await download.path();
      if (!tempPath) throw new Error("Falha ao salvar PDF temporário.");

      const fileBuffer = fs.readFileSync(tempPath);
      const cleanCnpj = empresa.cnpj.replace(/[^\d]/g, "");
      const fileName = `cnd_${slug}_${cleanCnpj}_${Date.now()}.pdf`;

      const { error: uploadError } = await supabase.storage
        .from("certidoes")
        .upload(fileName, fileBuffer, { contentType: "application/pdf" });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from("certidoes").getPublicUrl(fileName);
      const analise = await analisarCertidaoBuffer(fileBuffer, "MUNICIPAL");

      return {
        status: "sucesso",
        resultado: analise.resultado,
        pdf_url: publicUrlData.publicUrl,
        mensagem_erro: analise.detalhes || undefined
      };
    }

    const erroMsg = await page.locator(".alert-danger, .error-message, .mensagem-erro, .ui-messages-error").innerText().catch(() => "");
    if (erroMsg) {
      return {
        status: "erro",
        resultado: erroMsg.toUpperCase().includes("DÉBITO") ? "POSITIVA" : "ERRO",
        mensagem_erro: erroMsg.trim()
      };
    }

    return {
      status: "erro",
      resultado: "FALHA NA EMISSÃO",
      mensagem_erro: "Não foi possível emitir ou capturar o arquivo PDF no portal IPM."
    };

  } catch (err: any) {
    console.error(`[IPM - ${cidadeConfig.nomeOficial}] Erro:`, err.message);
    return {
      status: "erro",
      resultado: "FALHA NA EMISSÃO",
      mensagem_erro: err.message
    };
  } finally {
    await browser.close();
  }
}
