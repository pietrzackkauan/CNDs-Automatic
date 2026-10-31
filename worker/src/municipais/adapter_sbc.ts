import { chromium } from "playwright";
import { supabase } from "../supabase";
import fs from "fs";

export async function processarSBC(
  empresa: { nome: string; cnpj: string; inscricao_municipal?: string }
): Promise<{ status: string; resultado: string; pdf_url?: string; mensagem_erro?: string }> {
  console.log(`[SÃO BERNARDO DO CAMPO - SP] Iniciando emissão para CNPJ: ${empresa.cnpj}`);

  if (!empresa.inscricao_municipal) {
    return {
      status: "erro",
      resultado: "FALTA INSC. MUNICIPAL",
      mensagem_erro: "Prefeitura de São Bernardo do Campo exige a Inscrição Mobiliária na planilha."
    };
  }

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    const targetUrl = "https://www.saobernardo.sp.gov.br";
    console.log(`[SBC] Acessando portal: ${targetUrl}`);
    await page.goto(targetUrl, { timeout: 35000, waitUntil: "load" });
    await page.waitForTimeout(3000);

    // Preenche CNPJ e Inscrição Mobiliária
    const cnpjInput = page.locator("input[placeholder*='CNPJ'], input[id*='cnpj'], input[name*='cnpj']").first();
    if (await cnpjInput.count() > 0) {
      await cnpjInput.fill(empresa.cnpj.replace(/[^\d]/g, ""));
    }

    const imInput = page.locator("input[placeholder*='inscrição'], input[id*='im'], input[name*='mobiliaria']").first();
    if (await imInput.count() > 0) {
      await imInput.fill(empresa.inscricao_municipal.replace(/[^\d]/g, ""));
    }

    console.log(`[SBC] Solicitando emissão...`);
    const emitirBtn = page.locator("button:has-text('Emitir'), button:has-text('Consultar')").first();
    const downloadPromise = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);

    if (await emitirBtn.count() > 0) {
      await emitirBtn.click();
    }

    const download = await downloadPromise;
    if (download) {
      console.log(`[SBC] Certidão baixada!`);
      const tempPath = await download.path();
      if (!tempPath) throw new Error("Erro no download.");

      const fileBuffer = fs.readFileSync(tempPath);
      const cleanCnpj = empresa.cnpj.replace(/[^\d]/g, "");
      const fileName = `cnd_sbc_${cleanCnpj}_${Date.now()}.pdf`;

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
      mensagem_erro: "Não foi possível emitir ou capturar o arquivo PDF no portal de São Bernardo do Campo."
    };

  } catch (err: any) {
    console.error(`[SBC] Erro:`, err.message);
    return {
      status: "erro",
      resultado: "FALHA NA EMISSÃO",
      mensagem_erro: err.message
    };
  } finally {
    await browser.close();
  }
}
