import { chromium } from "playwright";
import { supabase } from "../supabase";
import { analisarCertidaoBuffer } from "../pdf_analyzer";
import fs from "fs";

export async function processarCorumba(
  empresa: { nome: string; cnpj: string; inscricao_municipal?: string }
): Promise<{ status: string; resultado: string; pdf_url?: string; mensagem_erro?: string }> {
  console.log(`[CORUMBÁ - MS] Iniciando processo para CNPJ: ${empresa.cnpj}`);

  if (!empresa.inscricao_municipal) {
    return {
      status: "erro",
      resultado: "FALTA INSC. MUNICIPAL",
      mensagem_erro: "Prefeitura de Corumbá exige a Inscrição Municipal/Econômica na planilha."
    };
  }

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    const targetUrl = "http://nfse.corumba.ms.gov.br:8080/servicosweb/home.jsf";
    console.log(`[CORUMBÁ] Acessando portal: ${targetUrl}`);
    await page.goto(targetUrl, { timeout: 35000, waitUntil: "load" });
    await page.waitForTimeout(3000);

    // Preenche CNPJ e Inscrição Municipal
    const cnpjInput = page.locator("input[placeholder*='CNPJ'], input[id*='cnpj'], input[name*='cnpj']").first();
    if (await cnpjInput.count() > 0) {
      await cnpjInput.fill(empresa.cnpj.replace(/[^\d]/g, ""));
    }

    const imInput = page.locator("input[placeholder*='inscrição'], input[id*='inscricao'], input[name*='im']").first();
    if (await imInput.count() > 0) {
      await imInput.fill(empresa.inscricao_municipal.replace(/[^\d]/g, ""));
    }

    console.log(`[CORUMBÁ] Disparando emissão...`);
    const emitirBtn = page.locator("button:has-text('Emitir'), button:has-text('Consultar'), input[type='submit']").first();
    const downloadPromise = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);

    if (await emitirBtn.count() > 0) {
      await emitirBtn.click();
    }

    const download = await downloadPromise;
    if (download) {
      console.log(`[CORUMBÁ] PDF capturado!`);
      const tempPath = await download.path();
      if (!tempPath) throw new Error("Falha no download.");

      const fileBuffer = fs.readFileSync(tempPath);
      const cleanCnpj = empresa.cnpj.replace(/[^\d]/g, "");
      const fileName = `cnd_corumba_${cleanCnpj}_${Date.now()}.pdf`;

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
      mensagem_erro: "Não foi possível emitir ou capturar o arquivo PDF no portal de Corumbá."
    };

  } catch (err: any) {
    console.error(`[CORUMBÁ] Erro:`, err.message);
    return {
      status: "erro",
      resultado: "FALHA NA EMISSÃO",
      mensagem_erro: err.message
    };
  } finally {
    await browser.close();
  }
}
