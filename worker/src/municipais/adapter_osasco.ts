import { chromium } from "playwright";
import { supabase } from "../supabase";
import { GoogleGenAI } from "@google/genai";
import { analisarCertidaoBuffer } from "../pdf_analyzer";
import fs from "fs";

export async function processarOsasco(
  empresa: { nome: string; cnpj: string; inscricao_municipal?: string }
): Promise<{ status: string; resultado: string; pdf_url?: string; mensagem_erro?: string }> {
  console.log(`[OSASCO - SP] Iniciando processo para CNPJ: ${empresa.cnpj}`);

  if (!empresa.inscricao_municipal) {
    return {
      status: "erro",
      resultado: "FALTA INSC. MUNICIPAL",
      mensagem_erro: "Prefeitura de Osasco exige o preenchimento da Inscrição Municipal na planilha."
    };
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const browser = await chromium.launch({
    headless: true,
    args: ["--ignore-certificate-errors", "--no-sandbox"]
  });

  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    console.log(`[OSASCO] Acessando formulário CND SIGT direto...`);
    const cndUrl = "https://sigt.osasco.sp.gov.br/iTRIB2/ArrSolicitarCnd_Internet.do";
    await page.goto(cndUrl, { timeout: 35000, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);

    // 1. Seleciona Tipo de Certidão: "Empresa"
    console.log(`[OSASCO] Selecionando tipo de certidão Empresa...`);
    const empresaRadio = page.locator("label:has-text('Empresa'), input[value*='Empresa']").first();
    await empresaRadio.click();
    await page.waitForTimeout(2000);

    // 2. Seleciona Finalidade (LICITAÇÃO ou primeira opção válida)
    const selectFinalidade = page.locator("select:visible").first();
    if (await selectFinalidade.count() > 0) {
      console.log(`[OSASCO] Selecionando finalidade...`);
      await selectFinalidade.selectOption({ label: "LICITAÇÃO" }).catch(async () => {
        await selectFinalidade.selectOption({ index: 1 });
      });
    }

    // 3. Preenche Inscrição Municipal (campo com maxlength=10)
    const imInput = page.locator("input.gwt-TextBox[maxlength='10']:visible").first();
    const cleanIm = empresa.inscricao_municipal.replace(/[^\d]/g, "");
    console.log(`[OSASCO] Preenchendo Inscrição Municipal: ${cleanIm}...`);
    await imInput.fill(cleanIm);

    // 4. Preenche CPF/CNPJ do Solicitante (campo com maxlength=18)
    const cleanCnpj = empresa.cnpj.replace(/[^\d]/g, "");
    const solicitanteInput = page.locator("input.gwt-TextBox[maxlength='18']:visible").first();
    if (await solicitanteInput.count() > 0) {
      console.log(`[OSASCO] Preenchendo CNPJ Solicitante: ${cleanCnpj}...`);
      await solicitanteInput.fill(cleanCnpj);
    }

    // 5. Preenche Email (maxlength=255) e Telefone (maxlength=12)
    const emailInput = page.locator("input.gwt-TextBox[maxlength='255']:not([disabled]):visible").first();
    if (await emailInput.count() > 0) {
      await emailInput.fill("certidoes@empresa.com.br");
    }

    const telInput = page.locator("input.gwt-TextBox[maxlength='12']:visible").first();
    if (await telInput.count() > 0) {
      await telInput.fill("11988887777");
    }

    let download = null;
    let alertMsg = "";

    for (let subAttempt = 1; subAttempt <= 3; subAttempt++) {
      if (subAttempt > 1) {
        console.log(`[OSASCO] Tentativa ${subAttempt} de envio do formulário...`);
        const fecharBtn = page.locator("button:has-text('FECHAR'):visible").first();
        if (await fecharBtn.count() > 0) {
          await fecharBtn.click();
          await page.waitForTimeout(1000);
        }
        const novaImgBtn = page.locator("button:has-text('Gerar nova imagem'):visible").first();
        if (await novaImgBtn.count() > 0) {
          await novaImgBtn.click();
          await page.waitForTimeout(2000);
        }
      }

      // 6. Resolução de Captcha com Gemini 3.8 Flash
      const captchaImg = page.locator("img[src*='gerarCaptcha']").first();
      if (await captchaImg.count() > 0) {
        console.log(`[OSASCO] Decifrando CAPTCHA via Gemini Vision (tentativa ${subAttempt})...`);
        const captchaBuf = await captchaImg.screenshot();
        let captchaCode = "";

        const modelsToTry = ["gemini-3.5-flash-lite", "gemini-3.8-flash"];
        for (const modelName of modelsToTry) {
          try {
            const res = await ai.models.generateContent({
              model: modelName,
              contents: [
                {
                  role: "user",
                  parts: [
                    { text: "Digite apenas os 4 caracteres alfanumericos deste captcha em letras maiusculas, sem espacos nem pontuacao." },
                    { inlineData: { data: captchaBuf.toString("base64"), mimeType: "image/png" } }
                  ]
                }
              ]
            });
            captchaCode = res.text?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") || "";
            if (captchaCode.length >= 4) {
              console.log(`[OSASCO] Gemini (${modelName}) leu captcha: ${captchaCode}`);
              break;
            }
          } catch (geminiErr: any) {
            console.warn(`[OSASCO] Falha na chamada do Gemini (${modelName}):`, geminiErr.message);
          }
        }

        const captchaInput = page.locator("input.gwt-TextBox[maxlength='4']:visible").first();
        await captchaInput.fill(captchaCode);
      }

      // 7. Clicar em Confirmar e aguardar download ou mensagem
      console.log(`[OSASCO] Confirmando solicitação de emissão...`);
      const downloadPromise = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
      const confirmBtn = page.locator("button:has(img[src*='btn_confirmar']):visible").first();
      await confirmBtn.click();

      download = await downloadPromise;
      if (download) break;

      await page.waitForTimeout(3000);
      const dialogs = await page.locator(".gwt-DialogBox, .dialog, .alert, .gwt-HTML").allInnerTexts().catch(() => []);
      alertMsg = dialogs.join(" ").trim();

      if (alertMsg.includes("Código da imagem não confere")) {
        console.log(`[OSASCO] Captcha incorreto, gerando nova imagem e tentando novamente...`);
        continue;
      } else {
        break;
      }
    }
    if (download) {
      console.log(`[OSASCO] PDF capturado com sucesso!`);
      const tempPath = await download.path();
      if (!tempPath) throw new Error("Erro ao capturar arquivo do download.");

      const fileBuffer = fs.readFileSync(tempPath);
      const fileName = `cnd_osasco_${cleanCnpj}_${Date.now()}.pdf`;

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

    // Checar mensagens / modais de alerta caso não tenha capturado
    if (!alertMsg) {
      const dialogs = await page.locator(".gwt-DialogBox, .dialog, .alert, .gwt-HTML").allInnerTexts().catch(() => []);
      alertMsg = dialogs.join(" ").trim();
    }

    if (alertMsg) {
      console.log(`[OSASCO] Alerta do portal: ${alertMsg}`);
      const upper = alertMsg.toUpperCase();
      return {
        status: "sucesso",
        resultado: upper.includes("DÉBITO") || upper.includes("DEBITO") || upper.includes("PENDÊNCIA") ? "POSITIVA" : "ERRO",
        mensagem_erro: alertMsg.replace(/[\n\t]+/g, " ").trim()
      };
    }

    return {
      status: "erro",
      resultado: "FALHA NA EMISSÃO",
      mensagem_erro: "Não foi possível emitir ou capturar o arquivo PDF no portal de Osasco."
    };

  } catch (err: any) {
    console.error(`[OSASCO - SP] Erro:`, err.message);
    return {
      status: "erro",
      resultado: "FALHA NA EMISSÃO",
      mensagem_erro: err.message
    };
  } finally {
    await browser.close();
  }
}
