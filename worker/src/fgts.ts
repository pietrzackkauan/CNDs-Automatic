import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import { supabase } from "./supabase";
import { analisarCertidaoBuffer } from "./pdf_analyzer";
import fs from "fs";

chromium.use(stealth());

export async function processarFGTS(cnpj: string): Promise<{ status: string; resultado: string; pdf_url?: string; mensagem_erro?: string }> {
  console.log(`[FGTS] Iniciando processamento autônomo (sem proxy/assinatura) para o CNPJ: ${cnpj}`);
  
  const cleanCnpj = cnpj.replace(/[^\d]/g, "");

  const browser = await chromium.launch({ 
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"]
  });

  try {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    });
    const page = await context.newPage();
    
    console.log(`[FGTS] Acessando portal da Caixa...`);
    await page.goto("https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf", { 
      waitUntil: "domcontentloaded", 
      timeout: 35000 
    });
    await page.waitForTimeout(2000);

    console.log(`[FGTS] Preenchendo CNPJ: ${cleanCnpj}...`);
    const inputLocator = page.locator("#mainForm\\:txtInscricao1, input[name*='txtInscricao'], input[type='text']").first();
    await inputLocator.fill(cleanCnpj);

    console.log(`[FGTS] Clicando em Consultar...`);
    const consultarBtn = page.locator("#mainForm\\:btnConsultar, button:has-text('Consultar'), input[type='button'][value*='Consultar'], input[type='submit'][value*='Consultar']").first();
    await consultarBtn.click();

    await page.waitForTimeout(4000);
    
    const bodyText = await page.innerText("body");

    // Verifica se a empresa está regular
    if (bodyText.includes("esta REGULAR no FGTS") || bodyText.includes("REGULARIDADE")) {
      console.log(`[FGTS] Empresa identificada como REGULAR! Acessando Certificado...`);
      const crfBtn = page.locator("a:has-text('Certificado de Regularidade'), input[value*='Certificado de Regularidade'], a:has-text('Obtenha')").first();
      if (await crfBtn.count() > 0) {
        await crfBtn.click();
        await page.waitForTimeout(3000);
      }

      // Gera PDF oficial do Certificado de Regularidade
      console.log(`[FGTS] Gerando PDF do Certificado de Regularidade...`);
      const pdfBuffer = await page.pdf({ format: "A4", printBackground: true }).catch(() => null);

      if (pdfBuffer && pdfBuffer.length > 500) {
        const fileName = `crf_fgts_${cleanCnpj}_${Date.now()}.pdf`;
        const { error: uploadError } = await supabase.storage
          .from("certidoes")
          .upload(fileName, pdfBuffer, { contentType: "application/pdf" });

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage.from("certidoes").getPublicUrl(fileName);
        const analise = await analisarCertidaoBuffer(pdfBuffer, "CAIXA");

        return {
          status: "sucesso",
          resultado: analise.resultado,
          pdf_url: publicUrlData.publicUrl,
          mensagem_erro: analise.detalhes || undefined
        };
      }
    }

    if (
      bodyText.includes("Não foi possível verificar a regularidade junto à CAIXA") ||
      bodyText.includes("comparecer a uma das Agências da CAIXA") ||
      bodyText.includes("comparecer a uma das Agencias")
    ) {
      console.log(`[FGTS] Bloqueio cadastral/operacional da Caixa para o CNPJ ${cleanCnpj}.`);
      return {
        status: "alerta",
        resultado: "BLOQUEIO CADASTRAL NA CAIXA",
        mensagem_erro: "A Caixa retornou: 'Não foi possível verificar a regularidade. Compareça a uma agência da CAIXA ou verifique pendências no FGTS Digital'."
      };
    }

    if (bodyText.includes("IRREGULAR") || bodyText.includes("não está regular") || bodyText.includes("constam pendências")) {
      return {
        status: "sucesso",
        resultado: "IRREGULAR",
        mensagem_erro: "Empresa possui pendências cadastrais ou financeiras perante o FGTS."
      };
    }

    if (bodyText.includes("não cadastrado") || bodyText.includes("Inscrição não encontrada")) {
      return {
        status: "sucesso",
        resultado: "NÃO CADASTRADO",
        mensagem_erro: "Inscrição não localizada no cadastro do FGTS."
      };
    }

    const erroCaixa = await page.locator(".mensagem-erro, .alerta, .alert-danger, .ui-messages-error").innerText().catch(() => "");
    if (erroCaixa) {
      return {
        status: "erro",
        resultado: erroCaixa.toUpperCase().includes("IRREGULAR") ? "IRREGULAR" : "ERRO",
        mensagem_erro: erroCaixa.trim()
      };
    }

    return { 
      status: "erro", 
      resultado: "FALHA NA EMISSÃO", 
      mensagem_erro: "Não foi possível extrair a regularidade do FGTS na página da Caixa." 
    };

  } catch (error: any) {
    console.error(`[FGTS] Erro inesperado:`, error.message);
    return {
      status: "erro",
      resultado: "ERRO",
      mensagem_erro: `Falha no portal da Caixa: ${error.message}`
    };
  } finally {
    await browser.close();
  }
}
