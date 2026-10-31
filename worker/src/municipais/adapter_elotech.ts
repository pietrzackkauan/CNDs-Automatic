import { chromium } from "playwright";
import { supabase } from "../supabase";
import { analisarCertidaoBuffer } from "../pdf_analyzer";
import fs from "fs";

export async function processarElotech(
  empresa: { nome: string; cnpj: string },
  cidadeConfig: { nomeOficial: string; uf: string; url: string }
): Promise<{ status: string; resultado: string; pdf_url?: string; mensagem_erro?: string }> {
  console.log(`[ELOTECH / OXY - ${cidadeConfig.nomeOficial}] Iniciando emissão para CNPJ: ${empresa.cnpj}`);

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    console.log(`[ELOTECH] Acessando portal: ${cidadeConfig.url}`);
    await page.goto(cidadeConfig.url, { timeout: 35000, waitUntil: "load" });
    await page.waitForTimeout(3000);

    // Preenche CNPJ
    const cnpjInput = page.locator("input[name*='cnpj'], input[id*='cnpj'], input[placeholder*='CNPJ'], input[type='text']").first();
    if (await cnpjInput.count() > 0) {
      await cnpjInput.fill(empresa.cnpj.replace(/[^\d]/g, ""));
    }

    console.log(`[ELOTECH] Solicitando emissão...`);
    const emitirBtn = page.locator("button:has-text('Emitir'), button:has-text('Consultar'), .btn-primary").first();
    const downloadPromise = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);

    if (await emitirBtn.count() > 0) {
      await emitirBtn.click();
    }

    const download = await downloadPromise;
    if (download) {
      console.log(`[ELOTECH] PDF capturado!`);
      const tempPath = await download.path();
      if (!tempPath) throw new Error("Erro no caminho do arquivo.");

      const fileBuffer = fs.readFileSync(tempPath);
      const cleanCnpj = empresa.cnpj.replace(/[^\d]/g, "");
      const safeCity = cidadeConfig.nomeOficial
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "_");
      const fileName = `cnd_elotech_${safeCity}_${cleanCnpj}_${Date.now()}.pdf`;

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
      mensagem_erro: "Não foi possível emitir ou capturar o arquivo PDF no portal Elotech."
    };

  } catch (err: any) {
    console.error(`[ELOTECH - ${cidadeConfig.nomeOficial}] Erro:`, err.message);
    return {
      status: "erro",
      resultado: "FALHA NA EMISSÃO",
      mensagem_erro: err.message
    };
  } finally {
    await browser.close();
  }
}
