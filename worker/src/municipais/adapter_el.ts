import { chromium } from "playwright";
import { supabase } from "../supabase";
import { GoogleGenAI } from "@google/genai";
import { analisarCertidaoBuffer } from "../pdf_analyzer";
import fs from "fs";

export async function processarEL(
  empresa: { nome: string; cnpj: string },
  cidadeConfig: { nomeOficial: string; uf: string; url: string }
): Promise<{ status: string; resultado: string; pdf_url?: string; mensagem_erro?: string }> {
  console.log(`[E&L PRODUÇÕES - ${cidadeConfig.nomeOficial}] Iniciando emissão para CNPJ: ${empresa.cnpj}`);

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  // Verifica se o Chrome em Modo Conectado (porta 9222) está disponível
  const cdpRes = await fetch("http://127.0.0.1:9222/json/version").catch(() => null);
  const isCdp = !!(cdpRes && cdpRes.ok);

  let browser: any = null;
  let page: any = null;

  try {
    if (isCdp) {
      console.log(`[E&L - ${cidadeConfig.nomeOficial}] Conectando ao Chrome via CDP na porta 9222...`);
      browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
      const contexts = browser.contexts();
      const context = contexts[0] || browser;
      page = await context.newPage();
    } else {
      browser = await chromium.launch({
        headless: true,
        args: ["--ignore-certificate-errors", "--no-sandbox"]
      });
      page = await browser.newPage();
    }

    console.log(`[E&L] Acessando portal: ${cidadeConfig.url}`);
    await page.goto(cidadeConfig.url, { timeout: 35000, waitUntil: "load" });
    // Fecha overlays ou tours interativos (ex: driver.js)
    await page.keyboard.press("Escape").catch(() => null);
    await page.evaluate(() => {
      document.querySelectorAll(".driver-overlay, .driver-popover, .modal-backdrop").forEach(el => el.remove());
    }).catch(() => null);

    // Se estiver no portal GPI (ex: Linhares)
    const searchInput = page.locator("input[placeholder*='Pesquisar']").first();
    if ((await searchInput.count()) > 0 && (await searchInput.isVisible())) {
      console.log(`[E&L] Portal GPI detectado. Pesquisando módulo de certidão...`);
      await searchInput.fill("certidão");
      await page.waitForTimeout(1200);
      const suggestion = page.locator(".tt-suggestion, strong:has-text('Certidão')").first();
      if ((await suggestion.count()) > 0) {
        await suggestion.click({ force: true }).catch(() => null);
        await page.waitForTimeout(4000);
      }
    }

    // 1. Preenche CNPJ
    const cnpjInput = page.locator("input[name*='cnpj' i], input[id*='cnpj' i], input[placeholder*='CNPJ' i], input[name*='cpf_cnpj' i], input[id*='cpf_cnpj' i], input[name*='documento' i]").first();
    const hasCnpjInput = (await cnpjInput.count()) > 0 && (await cnpjInput.isVisible());

    if (hasCnpjInput) {
      await cnpjInput.fill(empresa.cnpj.replace(/[^\d]/g, ""));
    } else {
      console.warn(`[E&L] Campo direto de CNPJ não encontrado na página.`);
      return {
        status: "alerta",
        resultado: "PORTAL EXIGE LOGIN",
        mensagem_erro: `O portal de ${cidadeConfig.nomeOficial} (${cidadeConfig.uf}) exige login individual no portal do contribuinte.`
      };
    }

    // 2. Se houver CAPTCHA de imagem clássico do PHP/JSP da E&L
    const captchaImg = page.locator("img[src*='captcha'], img[id*='captcha'], img[src*='securimage']").first();
    if (await captchaImg.count() > 0) {
      console.log(`[E&L] Captcha de imagem detectado. Decifrando com Gemini...`);
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
                  { text: "Leia os caracteres deste CAPTCHA. Responda APENAS com as letras e numeros, sem espacos e minusculo." },
                  { inlineData: { data: buffer.toString("base64"), mimeType: "image/png" } }
                ]
              }
            ]
          });
          captchaCode = res.text?.trim().toLowerCase().replace(/\s/g, "") || "";
          if (captchaCode.length > 2) {
            console.log(`[E&L] Gemini (${m}) leu captcha: ${captchaCode}`);
            break;
          }
        } catch (geminiErr: any) {
          console.warn(`[E&L] Erro na leitura do captcha (${m}):`, geminiErr.message);
        }
      }
      if (captchaCode) {
        const captchaInput = page.locator("input[name*='captcha'], input[id*='captcha'], input[placeholder*='caracteres']").first();
        if (await captchaInput.count() > 0) {
          await captchaInput.fill(captchaCode);
        }
      }
    }

    // 3. Clicar em Emitir / Gerar
    console.log(`[E&L] Submetendo requisição...`);
    const emitirBtn = page.locator("button:has-text('Emitir'), button:has-text('Gerar'), input[type='submit'], .btn-primary").first();
    const downloadPromise = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);

    if (await emitirBtn.count() > 0) {
      await emitirBtn.click();
    }

    const download = await downloadPromise;
    if (download) {
      console.log(`[E&L] PDF gerado com sucesso!`);
      const tempPath = await download.path();
      if (!tempPath) throw new Error("Erro ao salvar PDF.");

      const fileBuffer = fs.readFileSync(tempPath);
      const cleanCnpj = empresa.cnpj.replace(/[^\d]/g, "");
      const safeCity = cidadeConfig.nomeOficial
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "_");
      const fileName = `cnd_el_${safeCity}_${cleanCnpj}_${Date.now()}.pdf`;

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
      mensagem_erro: "Não foi possível emitir ou capturar o arquivo PDF no portal E&L."
    };

  } catch (err: any) {
    console.error(`[E&L - ${cidadeConfig.nomeOficial}] Erro:`, err.message);
    return {
      status: "erro",
      resultado: "FALHA NA EMISSÃO",
      mensagem_erro: err.message
    };
  } finally {
    if (page && !page.isClosed()) {
      await page.close().catch(() => null);
    }
    if (browser && !isCdp) {
      await browser.close().catch(() => null);
    }
  }
}
