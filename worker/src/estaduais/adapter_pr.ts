import { chromium } from "playwright";
import { supabase } from "../supabase";
import fs from "fs";
import path from "path";
import axios from "axios";
import { analisarCertidaoBuffer } from "../pdf_analyzer";

export async function processarEstadualPR(cnpj: string): Promise<{
  status: string;
  resultado: string;
  pdf_url?: string;
  mensagem_erro?: string;
}> {
  console.log(`[ESTADUAL-PR] Iniciando emissão para CNPJ: ${cnpj}`);
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
      acceptDownloads: true,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    });
    const page = await context.newPage();

    let certidaoApiResponse: any = null;

    page.on("response", async (resp) => {
      if (resp.url().includes("certidaoAutomatica")) {
        try {
          certidaoApiResponse = await resp.json();
        } catch {
          // Ignore non-json responses
        }
      }
    });

    console.log(`[ESTADUAL-PR] Acessando portal da SEFA-PR...`);
    await page.goto("https://cdwfazenda.paas.pr.gov.br/cdwportal/certidao/automatica", {
      waitUntil: "domcontentloaded",
      timeout: 35000
    });
    await page.waitForTimeout(3000);

    // Preenche CNPJ no input do formulário Quasar
    const inputCnpj = page.locator('input[type="text"]').first();
    await inputCnpj.waitFor({ state: "visible", timeout: 10000 });
    await inputCnpj.fill(cleanCnpj);
    await page.waitForTimeout(1000);

    console.log(`[ESTADUAL-PR] Clicando em 'EMITIR CERTIDÃO'...`);
    const btnEmitir = page.locator('button[type="submit"]:has-text("EMITIR CERTIDÃO")').or(page.locator('button:has-text("EMITIR CERTIDÃO")'));

    // Configura resolução se reCAPTCHA challenge for detectado via CapMonster
    const capmonsterKey = process.env.CAPMONSTER_API_KEY;
    if (capmonsterKey && capmonsterKey !== "cole_aqui_a_chave_do_capmonster") {
      try {
        console.log(`[ESTADUAL-PR] Resolvendo reCAPTCHA Enterprise antecipadamente via CapMonster...`);
        const taskRes = await axios.post("https://api.capmonster.cloud/createTask", {
          clientKey: capmonsterKey,
          task: {
            type: "RecaptchaV2EnterpriseTaskProxyless",
            websiteURL: "https://cdwfazenda.paas.pr.gov.br/cdwportal/certidao/automatica",
            websiteKey: "6LefsvgrAAAAANMWBz5JPyq5K2Z9KyOR6lDKSR_8"
          }
        });
        if (taskRes.data.taskId) {
          const taskId = taskRes.data.taskId;
          for (let i = 0; i < 15; i++) {
            await new Promise((r) => setTimeout(r, 2000));
            const check = await axios.post("https://api.capmonster.cloud/getTaskResult", {
              clientKey: capmonsterKey,
              taskId
            });
            if (check.data.status === "ready") {
              const token = check.data.solution?.gRecaptchaResponse;
              if (token) {
                await page.evaluate((t) => {
                  const el = document.getElementById("g-recaptcha-response") as HTMLTextAreaElement;
                  if (el) el.value = t;
                }, token);
                console.log(`[ESTADUAL-PR] Token reCAPTCHA injetado.`);
              }
              break;
            }
          }
        }
      } catch (err: any) {
        console.log(`[ESTADUAL-PR] Aviso no CapMonster (seguindo normalmente):`, err.message);
      }
    }

    await btnEmitir.first().click();
    await page.waitForTimeout(5000);

    // Avalia o objeto oficial retornado pela API da SEFA-PR
    let certidaoOficial: {
      numero?: string;
      tipo?: string;
      emissao?: string;
      validade?: string;
      resultado: string;
      detalhes?: string;
    } | null = null;

    if (certidaoApiResponse) {
      console.log(`[ESTADUAL-PR] Resposta da API recebida:`, JSON.stringify(certidaoApiResponse).slice(0, 300));
      
      if (certidaoApiResponse.mensagemErro || certidaoApiResponse.error) {
        const msg = certidaoApiResponse.mensagemErro || certidaoApiResponse.mensagem || certidaoApiResponse.error;
        const isPositiva = msg.toLowerCase().includes("débito") || msg.toLowerCase().includes("pendência");
        return {
          status: "sucesso",
          resultado: isPositiva ? "POSITIVA" : "ERRO",
          mensagem_erro: msg
        };
      }

      const certObj = certidaoApiResponse.certidao || 
        (certidaoApiResponse.listaCertidao && certidaoApiResponse.listaCertidao.length > 0 ? certidaoApiResponse.listaCertidao[0] : null);

      if (certObj && certObj.numeroCertidao) {
        const tipoLower = (certObj.tipoCertidao || "").toLowerCase();
        let resultadoDeterminado = "NEGATIVA";
        if (tipoLower.includes("positiva com efeito") || tipoLower.includes("positiva com efeitos")) {
          resultadoDeterminado = "POSITIVA COM EFEITO DE NEGATIVA";
        } else if (tipoLower.includes("positiva") && !tipoLower.includes("negativa")) {
          resultadoDeterminado = "POSITIVA";
        } else if (tipoLower.includes("negativa")) {
          resultadoDeterminado = "NEGATIVA";
        }

        certidaoOficial = {
          numero: certObj.numeroCertidao,
          tipo: certObj.tipoCertidao,
          emissao: certObj.emissao,
          validade: certObj.validade,
          resultado: resultadoDeterminado,
          detalhes: `Certidão ${resultadoDeterminado} nº ${certObj.numeroCertidao} emitida com sucesso pela SEFA-PR.`
        };
      } else if (certidaoApiResponse.certidao === false) {
        return {
          status: "sucesso",
          resultado: "POSITIVA COM EFEITO DE NEGATIVA",
          mensagem_erro: "Certidão não emitida automaticamente (constam pendências fiscais ou débitos para análise na SEFA-PR)."
        };
      }
    }

    // Tenta realizar o download do PDF oficial emitido através dos botões no diálogo Quasar
    let pdfUrl: string | undefined = undefined;
    try {
      const dialog = page.locator(".q-dialog");
      if (await dialog.count() > 0) {
        const downloadBtn = dialog.locator('button:has-text("Baixar PDF"), button:has-text("Baixar Certidão")').or(dialog.locator('button:has(.q-icon)'));
        if (await downloadBtn.count() > 0) {
          console.log(`[ESTADUAL-PR] Tentando download do PDF oficial no diálogo da SEFA-PR...`);
          const [download] = await Promise.all([
            page.waitForEvent("download", { timeout: 8000 }),
            downloadBtn.first().click()
          ]);
          if (download) {
            const fileName = `cnd_estadual_pr_${cleanCnpj}_${Date.now()}.pdf`;
            const tempPath = path.join(process.cwd(), "scratch", fileName);
            await download.saveAs(tempPath);
            const pdfBuffer = fs.readFileSync(tempPath);
            const { data: uploadData } = await supabase.storage
              .from("certidoes")
              .upload(fileName, pdfBuffer, { contentType: "application/pdf" });
            if (uploadData) {
              pdfUrl = supabase.storage.from("certidoes").getPublicUrl(fileName).data.publicUrl;
              console.log(`[ESTADUAL-PR] PDF oficial baixado e salvo no Storage: ${pdfUrl}`);
            }
            try { fs.unlinkSync(tempPath); } catch {}
          }
        }
      }
    } catch (err: any) {
      console.log(`[ESTADUAL-PR] Download direto do PDF no diálogo não completou: ${err.message}`);
    }

    // Se temos a certidão oficial reconhecida pela API
    if (certidaoOficial) {
      return {
        status: "sucesso",
        resultado: certidaoOficial.resultado,
        pdf_url: pdfUrl,
        mensagem_erro: certidaoOficial.detalhes
      };
    }

    // Fallback: se não capturou a resposta JSON da API, avalia o texto do corpo da página
    const bodyText = await page.innerText("body");
    if (bodyText.includes("Certidão Negativa") || bodyText.includes("não constam débitos")) {
      return {
        status: "sucesso",
        resultado: "NEGATIVA",
        pdf_url: pdfUrl,
        mensagem_erro: "Inexistência de débitos constatada na SEFA-PR."
      };
    } else if (bodyText.includes("Positiva com Efeitos de Negativa")) {
      return {
        status: "sucesso",
        resultado: "POSITIVA COM EFEITO DE NEGATIVA",
        pdf_url: pdfUrl,
        mensagem_erro: "Certidão Positiva com Efeitos de Negativa emitida pela SEFA-PR."
      };
    } else if (bodyText.includes("constam débitos exigíveis")) {
      return {
        status: "sucesso",
        resultado: "POSITIVA",
        mensagem_erro: "Constam débitos ou pendências fiscais exigíveis na SEFA-PR."
      };
    }

    const msgElement = page.locator(".q-notification, .q-banner, .text-negative, .alert");
    if (await msgElement.count() > 0) {
      const msg = await msgElement.first().innerText();
      return {
        status: "sucesso",
        resultado: msg.toLowerCase().includes("débito") ? "POSITIVA" : "AVISO",
        mensagem_erro: msg.trim()
      };
    }

    return {
      status: "sucesso",
      resultado: "PROCESSADO",
      mensagem_erro: "Consulta realizada na SEFA-PR."
    };

  } catch (error: any) {
    console.error(`[ESTADUAL-PR] Erro:`, error.message);
    return {
      status: "erro",
      resultado: "ERRO",
      mensagem_erro: `Falha no portal SEFA-PR: ${error.message}`
    };
  } finally {
    await browser.close();
  }
}
