import { chromium } from "playwright";
import { GoogleGenAI } from "@google/genai";
import { supabase } from "../supabase";
import { analisarCertidaoBuffer } from "../pdf_analyzer";

export async function processarEstadualMA(cnpj: string): Promise<{
  status: string;
  resultado: string;
  pdf_url?: string;
  mensagem_erro?: string;
}> {
  console.log(`[ESTADUAL-MA] Iniciando emissão para CNPJ: ${cnpj}`);
  const cleanCnpj = cnpj.replace(/\D/g, "");

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

    let pdfBuffer: Buffer | null = null;
    let popupPage: any = null;

    context.on("page", async (p) => {
      console.log(`[ESTADUAL-MA] Nova janela/popup detectada: ${p.url()}`);
      popupPage = p;
    });

    page.on("download", async (download) => {
      console.log(`[ESTADUAL-MA] Download disparado: ${download.suggestedFilename()}`);
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }
      pdfBuffer = Buffer.concat(chunks);
    });

    console.log(`[ESTADUAL-MA] Acessando portal da SEFAZ-MA...`);
    await page.goto("https://sistemas1.sefaz.ma.gov.br/certidoes/jsp/emissaoCertidaoNegativa/emissaoCertidaoNegativa.jsf", {
      waitUntil: "domcontentloaded",
      timeout: 35000
    });
    await page.waitForTimeout(2000);

    let maxRetries = 3;
    let sucessoProcessamento = false;
    let resultadoFinal = {
      status: "erro",
      resultado: "NÃO PROCESSADO",
      mensagem_erro: "Falha ao processar SEFAZ-MA"
    };

    for (let tentativa = 1; tentativa <= maxRetries; tentativa++) {
      console.log(`[ESTADUAL-MA] Tentativa ${tentativa} de ${maxRetries}...`);

      // Seleciona tipo de emissão: 2 = CPF/CNPJ
      const radioCnpj = page.locator('input[name*="tipoEmissao"][value="2"]');
      if (await radioCnpj.isVisible()) {
        await radioCnpj.click();
        await page.waitForTimeout(1500);
      }

      // Preenche o CNPJ
      const cnpjInput = page.locator('#form1\\:cpfCnpj').or(page.locator('input[name*="cpfCnpj"]')).first();
      await cnpjInput.fill(cleanCnpj);
      await page.waitForTimeout(500);

      // Localiza o CAPTCHA
      const captchaImg = page.locator('img[id*="captcha"]');
      await captchaImg.waitFor({ state: "visible", timeout: 10000 });
      const captchaBuffer = await captchaImg.screenshot();

      console.log(`[ESTADUAL-MA] Decifrando CAPTCHA via Gemini Vision (gemini-3.5-flash-lite)...`);
      let captchaText = "";
      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash-lite",
          contents: [
            {
              role: "user",
              parts: [
                { text: "Leia os caracteres deste CAPTCHA da SEFAZ Maranhão. Retorne APENAS os caracteres, sem espaços ou pontuação." },
                { inlineData: { data: captchaBuffer.toString("base64"), mimeType: "image/png" } }
              ]
            }
          ]
        });
        captchaText = response.text?.trim().replace(/\s/g, "") || "";
        console.log(`[ESTADUAL-MA] Gemini decifrou: ${captchaText}`);
      } catch (geminiErr: any) {
        console.warn(`[ESTADUAL-MA] Falha na chamada do Gemini:`, geminiErr.message);
      }

      const captchaInput = page.locator('input[name*="j_id20"]').or(page.locator('input[type="text"]').nth(1));
      await captchaInput.fill(captchaText);
      await page.waitForTimeout(500);

      console.log(`[ESTADUAL-MA] Clicando no botão Emitir Certidão...`);
      const btnEmitir = page.locator('input[value="Emitir Certidão"]:visible').or(page.locator('input[id*="j_id28"]'));
      await btnEmitir.click();

      // Aguarda resposta ou abertura de popup
      await page.waitForTimeout(5000);

      // Verifica textos na página de resposta
      const pageText = await page.evaluate(() => document.body.innerText);

      // Se captcha inválido, tenta novamente
      if (pageText.toLowerCase().includes("código") && (pageText.toLowerCase().includes("inválido") || pageText.toLowerCase().includes("incorreto"))) {
        console.warn(`[ESTADUAL-MA] Código de segurança inválido. Tentando novamente...`);
        await page.waitForTimeout(1000);
        continue;
      }

      // Se acusou devedor ou pendência fiscal
      if (
        pageText.toLowerCase().includes("é devedor") ||
        pageText.toLowerCase().includes("possui débito") ||
        pageText.toLowerCase().includes("irregularidade fiscal")
      ) {
        console.log(`[ESTADUAL-MA] Contribuinte identificado com débitos na SEFAZ-MA.`);
        sucessoProcessamento = true;
        resultadoFinal = {
          status: "sucesso",
          resultado: "POSITIVA",
          mensagem_erro: "Constam débitos ou pendências na SEFAZ-MA (Contribuinte devedor)."
        };
        break;
      }

      // Se abriu popup com a certidão
      const targetPage = popupPage || (context.pages().length > 1 ? context.pages()[1] : null);
      if (targetPage) {
        console.log(`[ESTADUAL-MA] Processando página da certidão no popup...`);
        await targetPage.waitForLoadState("domcontentloaded").catch(() => {});
        await targetPage.waitForTimeout(3000);
        const popupText = await targetPage.evaluate(() => document.body.innerText).catch(() => "");

        if (popupText.includes("CERTIDÃO") || popupText.includes("NEGATIVA") || popupText.includes("FAZENDA")) {
          pdfBuffer = await targetPage.pdf({ format: "A4" });
        }
      }

      // Se capturamos o PDF (seja por download ou popup)
      if (pdfBuffer) {
        console.log(`[ESTADUAL-MA] PDF obtido com sucesso (${pdfBuffer.length} bytes). Enviando ao Supabase Storage...`);
        const fileName = `cnd_estadual_ma_${cleanCnpj}_${Date.now()}.pdf`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("certidoes")
          .upload(fileName, pdfBuffer, { contentType: "application/pdf" });

        let pdfUrl = undefined;
        if (!uploadError && uploadData) {
          pdfUrl = supabase.storage.from("certidoes").getPublicUrl(fileName).data.publicUrl;
        }

        const analise = await analisarCertidaoBuffer(pdfBuffer, "ESTADUAL");
        sucessoProcessamento = true;
        resultadoFinal = {
          status: "sucesso",
          resultado: analise.resultado || "NEGATIVA",
          pdf_url: pdfUrl,
          mensagem_erro: analise.detalhes || undefined
        };
        break;
      }

      // Se não encontrou débito e não gerou PDF direto, verifica mensagem geral
      if (pageText.includes("Certidão Negativa") || pageText.includes("Regular")) {
        sucessoProcessamento = true;
        resultadoFinal = {
          status: "sucesso",
          resultado: "NEGATIVA",
          mensagem_erro: "Consulta realizada na SEFAZ-MA com situação regular."
        };
        break;
      }
    }

    return resultadoFinal;

  } catch (error: any) {
    console.error(`[ESTADUAL-MA] Erro crítico:`, error.message);
    return {
      status: "erro",
      resultado: "ERRO",
      mensagem_erro: `Falha no portal SEFAZ-MA: ${error.message}`
    };
  } finally {
    await browser.close();
  }
}
