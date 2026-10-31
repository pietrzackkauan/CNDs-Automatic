import { chromium } from "playwright";
import { GoogleGenAI } from "@google/genai";
import { supabase } from "../supabase";
import { analisarCertidaoBuffer } from "../pdf_analyzer";

function formatCnpj(digits: string): string {
  const d = digits.padStart(14, "0");
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

export async function processarEstadualMS(cnpj: string): Promise<{
  status: string;
  resultado: string;
  pdf_url?: string;
  mensagem_erro?: string;
}> {
  console.log(`[ESTADUAL-MS] Iniciando emissão para CNPJ: ${cnpj}`);
  const cleanCnpj = cnpj.replace(/\D/g, "");
  const formattedCnpj = formatCnpj(cleanCnpj);

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
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

    let printUrl: string | null = null;
    page.on("popup", async (popup) => {
      console.log(`[ESTADUAL-MS] Popup aberto: ${popup.url()}`);
      printUrl = popup.url();
    });

    console.log(`[ESTADUAL-MS] Acessando portal da SEFAZ-MS (e-Fazenda)...`);
    await page.goto("https://servicos.efazenda.ms.gov.br/pndfis/Home/Emissao", {
      waitUntil: "domcontentloaded",
      timeout: 35000
    });
    await page.waitForTimeout(2000);

    // Seleciona CNPJ
    await page.selectOption("#Tipo", { label: "CNPJ" });
    await page.waitForTimeout(500);

    // Preenche CNPJ formatado
    await page.fill("#Numero", formattedCnpj);
    await page.waitForTimeout(500);

    // Captura e resolve o captcha de imagem
    const captchaImg = page.locator("#imageCaptcha");
    await captchaImg.waitFor({ state: "visible", timeout: 10000 });
    const captchaBuffer = await captchaImg.screenshot();

    console.log(`[ESTADUAL-MS] Decifrando CAPTCHA via Gemini Vision...`);
    let captchaText = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const modelName = "gemini-3.8-flash";
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            {
              role: "user",
              parts: [
                { text: "Leia os caracteres deste CAPTCHA. Responda APENAS os caracteres, sem espaços, tudo em letras maiúsculas ou minúsculas exatamente como na imagem." },
                { inlineData: { data: captchaBuffer.toString("base64"), mimeType: "image/png" } }
              ]
            }
          ]
        });
        captchaText = response.text?.trim().replace(/\s/g, "") || "";
        console.log(`[ESTADUAL-MS] Gemini decifrou: ${captchaText}`);
        break;
      } catch (err: any) {
        console.error(`[ESTADUAL-MS] Tentativa ${attempt} falhou:`, err.message);
        if (attempt === 3) throw err;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    await page.fill("#CaptchaValue", captchaText);
    await page.waitForTimeout(500);

    console.log(`[ESTADUAL-MS] Clicando no botão Emitir...`);
    await page.click("#Emitir");
    await page.waitForTimeout(6000);

    // Se abrir modal alertando sobre certidão já existente dentro do prazo
    const modalBtn = page.locator('.btn-primary:has-text("Emitir Certidão")').or(page.locator('button:has-text("Emitir Certidão")'));
    if (await modalBtn.count() > 0) {
      console.log(`[ESTADUAL-MS] Modal de certidão existente detectado. Confirmando emissão...`);
      await modalBtn.first().click();
      await page.waitForTimeout(6000);
    }

    const mensagemErro = await page.locator("#mensagem").innerText().catch(() => "");
    if (mensagemErro && mensagemErro.trim().length > 0) {
      console.log(`[ESTADUAL-MS] Mensagem do portal: ${mensagemErro.trim()}`);
      const isPositiva = mensagemErro.toLowerCase().includes("débito") || mensagemErro.toLowerCase().includes("irregularidade");
      return {
        status: "sucesso",
        resultado: isPositiva ? "POSITIVA" : "AVISO",
        mensagem_erro: mensagemErro.trim()
      };
    }

    // Se tiver popup de impressão aberto
    const pages = context.pages();
    const targetPage = pages.find((p) => p.url().includes("Imprimir") || p.url().includes("pndfis/Home/EmissaoImprimir")) || page;

    await targetPage.waitForTimeout(3000);
    const contentText = await targetPage.innerText("body");

    if (contentText.includes("CERTIDÃO") || contentText.includes("Certidão Tributária") || contentText.includes("NEGATIVA")) {
      const fileName = `cnd_estadual_ms_${cleanCnpj}_${Date.now()}.pdf`;
      const pdfBuffer = await targetPage.pdf({ format: "A4" });

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
      mensagem_erro: "Consulta realizada na SEFAZ-MS."
    };

  } catch (error: any) {
    console.error(`[ESTADUAL-MS] Erro:`, error.message);
    return {
      status: "erro",
      resultado: "ERRO",
      mensagem_erro: `Falha no portal SEFAZ-MS: ${error.message}`
    };
  } finally {
    await browser.close();
  }
}
