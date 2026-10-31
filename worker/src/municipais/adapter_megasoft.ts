import { chromium } from "playwright";
import { supabase } from "../supabase";
import fs from "fs";

export async function processarMegaSoft(
  empresa: { nome: string; cnpj: string }
): Promise<{ status: string; resultado: string; pdf_url?: string; mensagem_erro?: string }> {
  console.log(`[MEGASOFT - PARANHOS MS] Iniciando processo para CNPJ: ${empresa.cnpj}`);

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    const targetUrl = "https://paranhos.megasoftservicos.com.br/cidadao/emissao-certidao-negat";
    console.log(`[MEGASOFT] Acessando portal: ${targetUrl}`);
    await page.goto(targetUrl, { timeout: 35000, waitUntil: "load" });
    await page.waitForTimeout(3000);

    // Preenche CNPJ
    const cnpjInput = page.locator("input[placeholder*='CNPJ'], input[id*='cnpj'], input[name*='cnpj'], input[type='text']").first();
    if (await cnpjInput.count() > 0) {
      await cnpjInput.fill(empresa.cnpj.replace(/[^\d]/g, ""));
    }

    console.log(`[MEGASOFT] Solicitando emissão...`);
    const emitirBtn = page.locator("button:has-text('Emitir'), button:has-text('Consultar'), button[type='submit']").first();
    const downloadPromise = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);

    if (await emitirBtn.count() > 0) {
      await emitirBtn.click();
    }

    const download = await downloadPromise;
    if (download) {
      console.log(`[MEGASOFT] PDF recebido!`);
      const tempPath = await download.path();
      if (!tempPath) throw new Error("Erro no caminho do arquivo.");

      const fileBuffer = fs.readFileSync(tempPath);
      const cleanCnpj = empresa.cnpj.replace(/[^\d]/g, "");
      const fileName = `cnd_paranhos_${cleanCnpj}_${Date.now()}.pdf`;

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
      mensagem_erro: "Não foi possível emitir ou capturar o arquivo PDF no portal Megasoft."
    };

  } catch (err: any) {
    console.error(`[MEGASOFT] Erro:`, err.message);
    return {
      status: "erro",
      resultado: "FALHA NA EMISSÃO",
      mensagem_erro: err.message
    };
  } finally {
    await browser.close();
  }
}
