import { chromium } from "playwright";
import { supabase } from "../supabase";
import { GoogleGenAI } from "@google/genai";
import fs from "fs";

export async function processarEPublica(
  empresa: { nome: string; cnpj: string; inscricao_municipal?: string }
): Promise<{ status: string; resultado: string; pdf_url?: string; mensagem_erro?: string }> {
  console.log(`[E-PÚBLICA - PÉROLA D'OESTE] Iniciando emissão para CNPJ: ${empresa.cnpj}`);

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    const targetUrl = "http://cidadao-peroladooeste.e-publica.net/peroladooeste_sefaz/jsp/cnd/index.jsp";
    console.log(`[E-PÚBLICA] Acessando portal: ${targetUrl}`);
    await page.goto(targetUrl, { timeout: 35000, waitUntil: "load" });
    await page.waitForTimeout(3000);

    // Preenche CNPJ
    const cnpjInput = page.locator("input[name*='cnpj'], input[id*='cnpj'], input[placeholder*='CNPJ'], input[type='text']").first();
    if (await cnpjInput.count() > 0) {
      await cnpjInput.fill(empresa.cnpj.replace(/[^\d]/g, ""));
    }

    // Se houver captcha de imagem da e-Pública
    const captchaImg = page.locator("img[src*='captcha'], img[id*='captcha']").first();
    if (await captchaImg.count() > 0) {
      console.log(`[E-PÚBLICA] Lendo imagem de captcha com Gemini...`);
      const buffer = await captchaImg.screenshot();
      const modelsToTry = ["gemini-3.5-flash-lite", "gemini-3.8-flash"];
      let captchaCode = "";
      for (const m of modelsToTry) {
        try {
          const res = await ai.models.generateContent({
            model: m,
            contents: [
              {
                role: "user",
                parts: [
                  { text: "Digite apenas os caracteres deste captcha em letras minusculas, sem espacos." },
                  { inlineData: { data: buffer.toString("base64"), mimeType: "image/png" } }
                ]
              }
            ]
          });
          captchaCode = res.text?.trim().toLowerCase().replace(/\s/g, "") || "";
          if (captchaCode.length > 2) {
            console.log(`[E-PÚBLICA] Gemini (${m}) leu captcha: ${captchaCode}`);
            break;
          }
        } catch (e: any) {
          console.warn(`[E-PÚBLICA] Erro no captcha (${m}):`, e.message);
        }
      }
      if (captchaCode) {
        const captchaInput = page.locator("input[name*='captcha'], input[id*='captcha']").first();
        if (await captchaInput.count() > 0) {
          await captchaInput.fill(captchaCode);
        }
      }
    }

    console.log(`[E-PÚBLICA] Disparando emissão...`);
    const emitirBtn = page.locator("button:has-text('Emitir'), input[type='submit'], button[type='submit']").first();
    const downloadPromise = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);

    if (await emitirBtn.count() > 0) {
      await emitirBtn.click();
    }

    const download = await downloadPromise;
    if (download) {
      console.log(`[E-PÚBLICA] PDF baixado com sucesso!`);
      const tempPath = await download.path();
      if (!tempPath) throw new Error("Falha ao salvar PDF.");

      const fileBuffer = fs.readFileSync(tempPath);
      const cleanCnpj = empresa.cnpj.replace(/[^\d]/g, "");
      const fileName = `cnd_peroladoeste_${cleanCnpj}_${Date.now()}.pdf`;

      const { error: uploadError } = await supabase.storage
        .from("certidoes")
        .upload(fileName, fileBuffer, { contentType: "application/pdf" });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from("certidoes").getPublicUrl(fileName);

      return {
        status: "sucesso",
        resultado: "NEGATIVA",
        pdf_url: publicUrlData.publicUrl
      };
    }

    const erroMsg = await page.locator(".alert-danger, .error-message, .mensagem-erro").innerText().catch(() => "");
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
      mensagem_erro: "Não foi possível emitir ou capturar o arquivo PDF no portal E-Pública."
    };

  } catch (err: any) {
    console.error(`[E-PÚBLICA] Erro:`, err.message);
    return {
      status: "erro",
      resultado: "FALHA NA EMISSÃO",
      mensagem_erro: err.message
    };
  } finally {
    await browser.close();
  }
}
