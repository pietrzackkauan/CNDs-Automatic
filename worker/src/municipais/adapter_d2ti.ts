import { chromium } from "playwright";
import { GoogleGenAI } from "@google/genai";
import { CidadeConfig } from "./cidades";
import { supabase } from "../supabase";
import { analisarCertidaoBuffer } from "../pdf_analyzer";

export async function processarD2TI(
  empresa: { nome: string; cnpj: string; inscricao_municipal?: string },
  cidadeConfig: CidadeConfig
): Promise<{
  status: string;
  resultado: string;
  pdf_url?: string;
  mensagem_erro?: string;
}> {
  console.log(`[D2TI-STM] Iniciando emissão para ${empresa.nome} (${empresa.cnpj}) em ${cidadeConfig.nomeOficial}/${cidadeConfig.uf}`);
  const cleanCnpj = empresa.cnpj.replace(/\D/g, "");

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
      console.log(`[D2TI-STM] Popup aberto: ${p.url()}`);
      popupPage = p;
    });

    page.on("download", async (download) => {
      console.log(`[D2TI-STM] Download acionado: ${download.suggestedFilename()}`);
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }
      pdfBuffer = Buffer.concat(chunks);
    });

    console.log(`[D2TI-STM] Acessando portal: ${cidadeConfig.url}`);
    await page.goto(cidadeConfig.url, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });
    await page.waitForTimeout(1500);

    // 1. Seleciona "Pessoa Jurídica" (radio value 2)
    const radioPJ = page.locator('input[name*="j_id67"][value="2"]');
    if (await radioPJ.isVisible()) {
      await radioPJ.click();
      await page.waitForTimeout(1500);
    }

    // 2. Preenche o CNPJ
    const cnpjInput = page.locator('input.cnpj').or(page.locator('input[name*="j_id77"]')).or(page.locator('input[type="text"]').first());
    await cnpjInput.fill(cleanCnpj);
    await page.waitForTimeout(500);

    // 3. Clica no botão de consulta rápida do CNPJ (ícone de checkmark / btn-success)
    console.log(`[D2TI-STM] Consultando cadastro do CNPJ na base municipal...`);
    const btnBuscar = page.locator('a.btn-success:has(i.icon-ok)').or(page.locator('a[id*="j_id79"]'));
    if (await btnBuscar.isVisible()) {
      await btnBuscar.click();
    } else {
      await cnpjInput.press("Tab");
    }
    await page.waitForTimeout(3000);

    // 4. Analisa mensagens de resposta do portal
    const pageText = await page.evaluate(() => document.body.innerText);
    const razaoSocial = await page.locator('input[name*="j_id87"]').inputValue().catch(() => "");
    console.log(`[D2TI-STM] Razão social identificada no portal: ${razaoSocial || "(vazio)"}`);

    // CNPJ não localizado na prefeitura (seja por mensagem ou por razão social vazia após busca)
    const normalizedText = pageText.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const hasNaoEncontrado = 
      normalizedText.includes("nao encontrado") ||
      normalizedText.includes("nao cadastrado") ||
      normalizedText.includes("encontrado") ||
      (!razaoSocial || razaoSocial.trim().length === 0);

    if (hasNaoEncontrado) {
      console.log(`[D2TI-STM] CNPJ não cadastrado no município de ${cidadeConfig.nomeOficial}.`);
      return {
        status: "alerta",
        resultado: "NÃO CADASTRADA NO MUNICÍPIO",
        mensagem_erro: `Contribuinte não localizado no cadastro tributário da Prefeitura de ${cidadeConfig.nomeOficial}/${cidadeConfig.uf}.`
      };
    }

    // 5. Seleciona modelo de certidão
    const selectModelos = page.locator('select[name*="colecaoModelos"]');
    if (await selectModelos.isVisible()) {
      const options = await selectModelos.locator("option").all();
      if (options.length > 1) {
        // Seleciona a primeira opção válida
        const val = await options[1].getAttribute("value");
        if (val) {
          await selectModelos.selectOption(val);
          await page.waitForTimeout(1000);
        }
      }
    }

    // 6. Preenche finalidade
    const finalidadeInput = page.locator('input[name*="j_id96"]').or(page.locator('input[maxlength="280"]'));
    if (await finalidadeInput.isVisible()) {
      await finalidadeInput.fill("Comprovação de regularidade fiscal");
      await page.waitForTimeout(500);
    }

    // 7. Resolve o CAPTCHA numérico/imagem
    const captchaImg = page.locator('img[src*="/credenciamento/captcha"]');
    if (await captchaImg.isVisible()) {
      const captchaBuf = await captchaImg.screenshot();
      console.log(`[D2TI-STM] Decifrando CAPTCHA via Gemini Vision (gemini-3.5-flash-lite)...`);
      let captchaText = "";
      try {
        const resp = await ai.models.generateContent({
          model: "gemini-3.5-flash-lite",
          contents: [
            {
              role: "user",
              parts: [
                { text: "Leia os números ou caracteres deste CAPTCHA. Responda APENAS os caracteres, sem espaços ou pontuação." },
                { inlineData: { data: captchaBuf.toString("base64"), mimeType: "image/png" } }
              ]
            }
          ]
        });
        captchaText = resp.text?.trim().replace(/\s/g, "") || "";
        console.log(`[D2TI-STM] Gemini decifrou: ${captchaText}`);
      } catch (geminiErr: any) {
        console.warn(`[D2TI-STM] Falha ao decifrar captcha:`, geminiErr.message);
      }

      const captchaInput = page.locator('input[name*="captcha"]').or(page.locator('#j_id59\\:captcha'));
      await captchaInput.fill(captchaText);
      await page.waitForTimeout(500);
    }

    // 8. Clica em "Emitir certidão"
    console.log(`[D2TI-STM] Clicando em Emitir Certidão...`);
    const btnEmitir = page.locator('a:has-text("Emitir certidão")').or(page.locator('a[id*="j_id110"]'));
    await btnEmitir.click();
    await page.waitForTimeout(6000);

    // 9. Verifica se gerou débito ou erro
    const afterSubmitText = await page.evaluate(() => document.body.innerText);
    if (
      afterSubmitText.toLowerCase().includes("débito") ||
      afterSubmitText.toLowerCase().includes("debito") ||
      afterSubmitText.toLowerCase().includes("pendência") ||
      afterSubmitText.toLowerCase().includes("pendencia")
    ) {
      console.log(`[D2TI-STM] Débito apontado pela prefeitura.`);
      return {
        status: "sucesso",
        resultado: "POSITIVA",
        mensagem_erro: "Constam débitos tributários pendentes na Prefeitura."
      };
    }

    // 10. Processa PDF gerado
    const targetPage = popupPage || (context.pages().length > 1 ? context.pages()[1] : null);
    if (targetPage) {
      await targetPage.waitForLoadState("domcontentloaded").catch(() => {});
      await targetPage.waitForTimeout(3000);
      const text = await targetPage.evaluate(() => document.body.innerText).catch(() => "");
      if (text.includes("CERTIDÃO") || text.includes("NEGATIVA") || text.includes("PREFEITURA")) {
        pdfBuffer = await targetPage.pdf({ format: "A4" });
      }
    }

    if (pdfBuffer) {
      console.log(`[D2TI-STM] PDF capturado com sucesso (${pdfBuffer.length} bytes). Salvando no Supabase...`);
      const fileName = `cnd_municipal_imperatriz_${cleanCnpj}_${Date.now()}.pdf`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("certidoes")
        .upload(fileName, pdfBuffer, { contentType: "application/pdf" });

      let pdfUrl = undefined;
      if (!uploadError && uploadData) {
        pdfUrl = supabase.storage.from("certidoes").getPublicUrl(fileName).data.publicUrl;
      }

      const analise = await analisarCertidaoBuffer(pdfBuffer, "MUNICIPAL");
      return {
        status: "sucesso",
        resultado: analise.resultado || "NEGATIVA",
        pdf_url: pdfUrl,
        mensagem_erro: analise.detalhes || undefined
      };
    }

    return {
      status: "sucesso",
      resultado: "PROCESSADO",
      mensagem_erro: "Consulta realizada no portal municipal de Imperatriz/MA."
    };

  } catch (error: any) {
    console.error(`[D2TI-STM] Erro na emissão:`, error.message);
    return {
      status: "erro",
      resultado: "ERRO",
      mensagem_erro: `Falha no portal municipal de Imperatriz/MA: ${error.message}`
    };
  } finally {
    await browser.close();
  }
}
