import { chromium } from "playwright";
import { supabase } from "../supabase";
import { analisarCertidaoBuffer } from "../pdf_analyzer";

export async function processarBetha(
  empresa: { nome: string; cnpj: string },
  cidadeConfig: { nomeOficial: string; uf: string; url: string }
): Promise<{ status: string; resultado: string; pdf_url?: string; mensagem_erro?: string }> {
  console.log(`[BETHA - ${cidadeConfig.nomeOficial}] Iniciando emissão para CNPJ: ${empresa.cnpj}`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--ignore-certificate-errors", "--no-sandbox"]
  });

  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    let capturedPdfBuffer: Buffer | null = null;
    context.on("response", async (res) => {
      try {
        const ct = res.headers()["content-type"] || "";
        const url = res.url();
        if (ct.includes("pdf") || url.includes("reportasync") || url.includes("stream") || url.includes("download")) {
          const buf = await res.body().catch(() => null);
          if (buf && buf.length > 500 && buf.slice(0, 4).toString() === "%PDF") {
            capturedPdfBuffer = buf;
            console.log(`[BETHA] PDF REAL interceptado com sucesso! Tamanho: ${buf.length} bytes`);
          }
        }
      } catch (e: any) {
        console.warn(`[BETHA] Aviso ao ler buffer da resposta:`, e.message);
      }
    });

    console.log(`[BETHA] Acessando portal: ${cidadeConfig.url}`);
    await page.goto(cidadeConfig.url, { timeout: 35000, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // Se estiver na tela de seleção de estado/município
    const estadoSelect = page.locator("#mainForm\\:estados");
    if (await estadoSelect.count() > 0) {
      console.log(`[BETHA] Selecionando estado PR (código 21)...`);
      await estadoSelect.selectOption("21").catch(async () => {
        await estadoSelect.selectOption({ label: "PR - Paraná" });
      });
      await estadoSelect.evaluate((el: any) => el.dispatchEvent(new Event('change', { bubbles: true })));
      await page.waitForTimeout(2000);

      // Procura código do município (Capitão Leônidas Marques = 782)
      console.log(`[BETHA] Selecionando município 782...`);
      await page.locator("#mainForm\\:municipios").selectOption("782").catch(async () => {
        await page.locator("#mainForm\\:municipios").selectOption({ label: "Prefeitura Municipal de Capitao Leonidas Marques" });
      });
      await page.waitForTimeout(1000);

      console.log(`[BETHA] Confirmando entidade...`);
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null),
        page.locator("#mainForm\\:selecionar").click()
      ]);
      await page.waitForTimeout(2000);
    }

    // Navega diretamente para rel_cndcontribuinte.faces
    const targetCndUrl = page.url().replace(/[^/]+\.faces.*$/, "rel_cndcontribuinte.faces");
    console.log(`[BETHA] Navegando para targetCndUrl: ${targetCndUrl}`);
    await page.goto(targetCndUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // 1. Clicar no modo CNPJ para expandir o formulário
    console.log(`[BETHA] Clicando na aba CNPJ...`);
    await page.locator("a.cnpj.btModo").click();
    await page.waitForTimeout(1000);

    // 2. Preencher CNPJ
    const cleanCnpj = empresa.cnpj.replace(/[^\d]/g, "");
    console.log(`[BETHA] Preenchendo CNPJ: ${cleanCnpj}...`);
    await page.locator("#mainForm\\:cnpj").fill(cleanCnpj);
    await page.waitForTimeout(500);

    // 3. Clicar em Continuar (#mainForm:btCnpj)
    console.log(`[BETHA] Clicando em Continuar...`);
    await page.locator("#mainForm\\:btCnpj").click();
    await page.waitForTimeout(4000);

    // 4. Verificar se retornou erro ou mensagem de débitos
    const erroMsg = await page.locator("#mainForm\\:master\\:messageSection\\:error, .ui-messages-error, .alert-danger").innerText().catch(() => "");
    if (erroMsg) {
      const upper = erroMsg.toUpperCase();
      console.log(`[BETHA] Mensagem do portal: ${erroMsg}`);
      const isPositiva = upper.includes("DÉBITO") || upper.includes("DEBITO") || upper.includes("PENDÊNCIA");
      const isNaoEncontrada = upper.includes("NÃO ENCONTRAD") || upper.includes("NÃO LOCALIZAD");
      return {
        status: isPositiva ? "sucesso" : isNaoEncontrada ? "alerta" : "erro",
        resultado: isPositiva ? "POSITIVA" : isNaoEncontrada ? "NÃO CADASTRADA NO MUNICÍPIO" : "ERRO",
        mensagem_erro: erroMsg.trim()
      };
    }

    // 5. Clicar no botão / ícone de Emitir na tabela
    console.log(`[BETHA] Aguardando ícone de emitir certidão...`);
    const printImg = page.locator("img[alt='Emitir'], img[title*='Emite a CND'], #mainForm\\:t-contribuinte img").first();
    await printImg.waitFor({ state: "visible", timeout: 12000 });
    console.log(`[BETHA] Clicando no ícone de emitir certidão...`);
    const popupPromise = context.waitForEvent("page", { timeout: 8000 }).catch(() => null);
    await printImg.click();

    const popup = await popupPromise;
    if (popup) {
      console.log(`[BETHA] Visualizador aberto em popup...`);
      await popup.waitForLoadState("domcontentloaded").catch(() => null);
      await page.waitForTimeout(2000);
      const downloadBtn = popup.locator("#download, button#download, a#download").first();
      if (await downloadBtn.count() > 0) {
        console.log(`[BETHA] Disparando download interno do viewer PDF...`);
        const dlPromise = popup.waitForEvent("download", { timeout: 8000 }).catch(() => null);
        await downloadBtn.click().catch(() => null);
        const dl = await dlPromise;
        if (dl) {
          const tempPath = await dl.path();
          if (tempPath) {
            const fs = await import("fs");
            capturedPdfBuffer = fs.readFileSync(tempPath);
            console.log(`[BETHA] PDF baixado com sucesso via viewer! Tamanho: ${capturedPdfBuffer.length} bytes`);
          }
        }
      }
    }

    // 6. Aguarda interceptação do buffer do PDF
    console.log(`[BETHA] Aguardando geração e streaming do PDF...`);
    for (let i = 0; i < 40; i++) {
      if (capturedPdfBuffer && (capturedPdfBuffer as Buffer).slice(0, 4).toString() === "%PDF") break;
      await page.waitForTimeout(500);
    }

    // 7. Se capturou o PDF via buffer direto
    if (capturedPdfBuffer && (capturedPdfBuffer as Buffer).length > 500) {
      const safeCity = cidadeConfig.nomeOficial
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "_");
      const fileName = `cnd_betha_${safeCity}_${cleanCnpj}_${Date.now()}.pdf`;
      console.log(`[BETHA] Enviando PDF oficial (${(capturedPdfBuffer as Buffer).length} bytes) como ${fileName} para o Supabase Storage...`);

      const { error: uploadError } = await supabase.storage
        .from("certidoes")
        .upload(fileName, capturedPdfBuffer, { contentType: "application/pdf" });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from("certidoes").getPublicUrl(fileName);

      const analise = await analisarCertidaoBuffer(capturedPdfBuffer as Buffer, "MUNICIPAL");

      return {
        status: "sucesso",
        resultado: analise.resultado,
        pdf_url: publicUrlData.publicUrl,
        mensagem_erro: analise.detalhes || undefined
      };
    }

    // Checar se há texto na página indicando situação
    const bodyText = await page.innerText("body").catch(() => "");
    if (bodyText.includes("não constam débitos") || bodyText.includes("está pronta para ser emitida")) {
      return {
        status: "sucesso",
        resultado: "NEGATIVA",
        mensagem_erro: "Certidão Negativa emitida perante o portal Betha."
      };
    }

    return {
      status: "erro",
      resultado: "FALHA NA EMISSÃO",
      mensagem_erro: "Não foi possível emitir ou capturar o arquivo PDF no portal Betha."
    };

  } catch (err: any) {
    console.error(`[BETHA - ${cidadeConfig.nomeOficial}] Erro:`, err.message);
    return {
      status: "erro",
      resultado: "FALHA NA EMISSÃO",
      mensagem_erro: err.message
    };
  } finally {
    await browser.close();
  }
}
