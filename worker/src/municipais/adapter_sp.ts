import { chromium } from "playwright";
import { supabase } from "../supabase";
import { analisarCertidaoBuffer } from "../pdf_analyzer";
import fs from "fs";

export async function processarSaoPaulo(
  empresa: { nome: string; cnpj: string }
): Promise<{ status: string; resultado: string; pdf_url?: string; mensagem_erro?: string }> {
  console.log(`[SÃO PAULO CAPITAL - DUC] Iniciando emissão para CNPJ: ${empresa.cnpj}`);

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    const targetUrl = "https://duc.prefeitura.sp.gov.br/certidoes/forms_anonimo/frmConsultaEmissaoCertidao.aspx";
    console.log(`[SÃO PAULO] Acessando DUC Fazenda: ${targetUrl}`);
    await page.goto(targetUrl, { timeout: 35000, waitUntil: "load" });
    await page.waitForTimeout(3000);

    // Seleciona tipo de certidão (Tributos Mobiliários)
    const radioMobiliario = page.locator("input[value*='Mobili'], input[id*='rbMobiliario'], label:has-text('Mobiliário')").first();
    if (await radioMobiliario.count() > 0) {
      await radioMobiliario.click().catch(() => {});
    }

    // Preenche CNPJ
    const cleanCnpj = empresa.cnpj.replace(/[^\d]/g, "");
    const cnpjInput = page.locator("input[name*='Cnpj'], input[id*='Cnpj'], input[name*='Documento']").first();
    if (await cnpjInput.count() > 0) {
      await cnpjInput.fill(cleanCnpj);
    }

    console.log(`[SÃO PAULO] Clicando em Emitir Certidão...`);
    const emitirBtn = page.locator("input[value*='Emitir'], button:has-text('Emitir'), input[type='submit']").first();
    const downloadPromise = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);

    if (await emitirBtn.count() > 0) {
      await emitirBtn.click();
    }

    const download = await downloadPromise;
    if (download) {
      console.log(`[SÃO PAULO] Certidão baixada!`);
      const tempPath = await download.path();
      if (!tempPath) throw new Error("Falha no download.");

      const fileBuffer = fs.readFileSync(tempPath);
      const fileName = `cnd_saopaulo_${cleanCnpj}_${Date.now()}.pdf`;

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
      mensagem_erro: "Não foi possível emitir ou capturar o arquivo PDF no portal de São Paulo (DUCAD)."
    };

  } catch (err: any) {
    console.error(`[SÃO PAULO] Erro:`, err.message);
    return {
      status: "erro",
      resultado: "FALHA NA EMISSÃO",
      mensagem_erro: err.message
    };
  } finally {
    await browser.close();
  }
}
