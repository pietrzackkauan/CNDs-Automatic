import { chromium } from "playwright";
import { supabase } from "../supabase";
import { analisarCertidaoBuffer } from "../pdf_analyzer";
import fs from "fs";

export async function processarEquiplano(
  empresa: { nome: string; cnpj: string; inscricao_municipal?: string },
  cidadeConfig: { nomeOficial: string; uf: string; url: string }
): Promise<{ status: string; resultado: string; pdf_url?: string; mensagem_erro?: string }> {
  console.log(`[EQUIPLANO - ${cidadeConfig.nomeOficial}] Iniciando emissão para CNPJ: ${empresa.cnpj}`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--ignore-certificate-errors", "--no-sandbox"]
  });

  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    const portalUrl = cidadeConfig.url.includes("contribuinte") 
      ? `${cidadeConfig.url.replace(/\/+$/, '')}/#/stmCertidaoNegativa/certidaoNegativa`
      : `https://${cidadeConfig.nomeOficial.toLowerCase().replace(/\s+/g, '')}pr.equiplano.com.br:8443/contribuinte/#/stmCertidaoNegativa/certidaoNegativa`;

    console.log(`[EQUIPLANO] Acessando portal: ${portalUrl}`);
    
    let backendErrorMessage = "";
    let situacaoDetectada = "NEGATIVA";
    let contributorFound = false;
    let latestCertidaoId: number | null = null;
    let latestCertidaoNumero: string = "";

    page.on("response", async (res) => {
      const url = res.url();
      if (url.includes("certidao-negativa/contribuinte")) {
        try {
          const data = await res.json();
          if (data?.idCadastro || data?.contribuinte) {
            contributorFound = true;
            if (data?.certidoesContribuinte?.length > 0) {
              const ult = data.certidoesContribuinte[0];
              if (ult.idCertidao) latestCertidaoId = ult.idCertidao;
              if (ult.dsCertidao) latestCertidaoNumero = ult.dsCertidao;
              if (ult.tpCertidao) situacaoDetectada = ult.tpCertidao.toUpperCase();
            }
          }
          const msg = data?.esMensagens?.mensagens?.[0]?.mensagem;
          if (msg) backendErrorMessage = msg;
        } catch {}
      } else if (url.includes("certidao-negativa") && res.request().method() === "POST") {
        try {
          const postData = await res.json();
          const msg = postData?.mensagens?.[0]?.mensagem || postData?.esMensagens?.mensagens?.[0]?.mensagem;
          if (msg) backendErrorMessage = msg;
        } catch {}
      }
    });

    await page.goto(portalUrl, { timeout: 35000, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // Dismiss cookie banner if present
    const cookieBtn = page.locator('button:has-text("Aceitar")');
    if (await cookieBtn.count() > 0) {
      await cookieBtn.first().click().catch(() => null);
      await page.waitForTimeout(1000);
    }

    const selectLocator = page.locator("#cadastro-selecao-contribuinte");
    const cleanCnpj = empresa.cnpj.replace(/[^\d]/g, "");

    // 1. Tenta primeiro como "Empresa do município" (mais comum para prefeitura local)
    console.log(`[EQUIPLANO] Buscando como Empresa do Município...`);
    await selectLocator.selectOption({ label: "Empresa do município" }).catch(() => selectLocator.selectOption({ index: 2 }));
    await page.waitForTimeout(1000);

    if (empresa.inscricao_municipal) {
      const imInput = page.locator("#nrInscricaoMunicipal").first();
      if (await imInput.count() > 0) {
        await imInput.fill(empresa.inscricao_municipal.replace(/[^\d]/g, ""));
      }
    }

    const cnpjInput = page.locator("#cnpj").first();
    if (await cnpjInput.count() > 0) {
      await cnpjInput.fill(cleanCnpj);
      await cnpjInput.press("Enter");
      await cnpjInput.blur();
    }

    await page.waitForTimeout(3000);

    // Se não encontrou como empresa do município, tenta como "Empresa de fora"
    if (!contributorFound) {
      console.log(`[EQUIPLANO] Não localizado no município. Tentando como Empresa de Fora...`);
      backendErrorMessage = "";
      await selectLocator.selectOption({ label: "Empresa de fora" }).catch(() => selectLocator.selectOption({ index: 3 }));
      await page.waitForTimeout(1000);

      const cnpjInputFora = page.locator("#cnpj").first();
      if (await cnpjInputFora.count() > 0) {
        await cnpjInputFora.fill(cleanCnpj);
        await cnpjInputFora.press("Enter");
        await cnpjInputFora.blur();
      }
      await page.waitForTimeout(3000);
    }

    // Se houver toast de erro e não localizou
    const toastLocator = page.locator(".notification.alert-danger, .alert-danger, .toast-error");
    if (await toastLocator.count() > 0 && !contributorFound) {
      const toastText = (await toastLocator.first().innerText()).replace(/^×\s*/, "").trim();
      if (toastText) backendErrorMessage = toastText;
    }

    if (!contributorFound && backendErrorMessage) {
      console.warn(`[EQUIPLANO - ${cidadeConfig.nomeOficial}] Mensagem do portal: ${backendErrorMessage}`);
      const upperMsg = backendErrorMessage.toUpperCase();
      const isPositiva = upperMsg.includes("DÉBITO") || upperMsg.includes("DEBITO");
      const isNaoEncontrada = upperMsg.includes("NÃO ENCONTRAD") || upperMsg.includes("NÃO LOCALIZAD");
      return {
        status: isPositiva ? "sucesso" : isNaoEncontrada ? "alerta" : "erro",
        resultado: isPositiva ? "POSITIVA" : isNaoEncontrada ? "NÃO CADASTRADA NO MUNICÍPIO" : "ERRO",
        mensagem_erro: backendErrorMessage
      };
    }

    // 2. Contribuinte localizado! Verificar histórico ou emitir nova certidão
    console.log(`[EQUIPLANO] Contribuinte localizado com sucesso!`);

    // Seleciona finalidade se houver
    const finalidadeSelect = page.locator("#finalidades, select[id*='finalidade']").first();
    if (await finalidadeSelect.count() > 0) {
      await finalidadeSelect.selectOption({ index: 1 }).catch(() => null);
      await page.waitForTimeout(800);
    }

    // Preenche dados do requerente se os campos estiverem visíveis
    const nmReq = page.locator("#nmRequerente");
    if (await nmReq.count() > 0) {
      await nmReq.fill(empresa.nome || "CONTRIBUINTE");
    }
    const cpfReq = page.locator("#cpfCnpjRequerente");
    if (await cpfReq.count() > 0) {
      await cpfReq.fill(cleanCnpj);
    }

    // Clica em "Gerar nova certidão" se o botão estiver visível
    const gerarNovaBtn = page.locator("#gerar-nova-certidao, button:has-text('Gerar nova certidão')").first();
    if (await gerarNovaBtn.count() > 0) {
      console.log(`[EQUIPLANO] Disparando geração de nova certidão...`);
      await gerarNovaBtn.click().catch(() => null);
      await page.waitForTimeout(3000);
    }

    // Checa a situação na tabela do Histórico
    const tabelaLinhas = page.locator("table tbody tr");
    if (await tabelaLinhas.count() > 0) {
      const rowText = await tabelaLinhas.first().innerText();
      if (rowText.toUpperCase().includes("POSITIVA")) {
        situacaoDetectada = "POSITIVA";
      } else if (rowText.toUpperCase().includes("NEGATIVA")) {
        situacaoDetectada = "NEGATIVA";
      }
    }

    // 3. Capturar o download clicando na lupa da PRIMEIRA certidão (mais recente do topo da tabela)
    console.log(`[EQUIPLANO] Baixando documento da certidão mais recente (ID: ${latestCertidaoId || 'topo'}, Situação: ${situacaoDetectada})...`);
    const lupaBtn = page.locator("#visualizar-0, table tbody tr:first-child button, table tbody tr:first-child a").first();
    
    let download: any = null;
    if (await lupaBtn.count() > 0) {
      const downloadPromise = page.waitForEvent("download", { timeout: 20000 }).catch(() => null);
      await lupaBtn.click().catch(() => null);
      download = await downloadPromise;
    }

    let fileBuffer: Buffer | null = null;
    if (download) {
      console.log(`[EQUIPLANO] PDF real capturado pelo navegador com sucesso!`);
      const tempPath = await download.path();
      if (tempPath) fileBuffer = fs.readFileSync(tempPath);
    }

    // Fallback de segurança: se o clique não disparou evento de download, busca direto pelo endpoint REST
    if (!fileBuffer && latestCertidaoId) {
      console.log(`[EQUIPLANO] Baixando diretamente pelo endpoint oficial /certidao/${latestCertidaoId}...`);
      try {
        const prefix = portalUrl.split("/contribuinte")[0] || `https://${cidadeConfig.nomeOficial.toLowerCase().replace(/\s+/g, '')}pr.equiplano.com.br:8443`;
        const directUrl = `${prefix}/portalContribuinteRest/certidao-negativa/certidao/${latestCertidaoId}`;
        const restRes = await page.request.get(directUrl).catch(() => null);
        if (restRes && restRes.status() === 200) {
          fileBuffer = await restRes.body();
          console.log(`[EQUIPLANO] PDF recuperado via REST com sucesso (${fileBuffer.length} bytes)!`);
        }
      } catch (e: any) {
        console.warn(`[EQUIPLANO] Aviso no fallback REST:`, e.message);
      }
    }

    if (fileBuffer) {
      const safeCity = cidadeConfig.nomeOficial
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "_");
      const fileName = `cnd_${safeCity}_${cleanCnpj}_${Date.now()}.pdf`;

      const { error: uploadError } = await supabase.storage
        .from("certidoes")
        .upload(fileName, fileBuffer, { contentType: "application/pdf" });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from("certidoes").getPublicUrl(fileName);

      const analise = await analisarCertidaoBuffer(fileBuffer, "MUNICIPAL");
      const resultadoFinal = analise.resultado !== "ERRO" ? analise.resultado : situacaoDetectada;
      const msgDetalhe = analise.detalhes || (latestCertidaoNumero 
        ? `Certidão ${resultadoFinal} nº ${latestCertidaoNumero} emitida pela Prefeitura de ${cidadeConfig.nomeOficial}.`
        : undefined);

      return {
        status: "sucesso",
        resultado: resultadoFinal,
        pdf_url: publicUrlData.publicUrl,
        mensagem_erro: msgDetalhe
      };
    }

    // Se houver mensagem de aviso/bloqueio
    if (backendErrorMessage) {
      return {
        status: situacaoDetectada === "POSITIVA" ? "sucesso" : "erro",
        resultado: situacaoDetectada,
        mensagem_erro: backendErrorMessage
      };
    }

    return {
      status: "erro",
      resultado: "FALHA NA EMISSÃO",
      mensagem_erro: "Não foi possível baixar o PDF da certidão na prefeitura."
    };

  } catch (err: any) {
    console.error(`[EQUIPLANO - ${cidadeConfig.nomeOficial}] Erro:`, err.message);
    return {
      status: "erro",
      resultado: "FALHA NA EMISSÃO",
      mensagem_erro: err.message
    };
  } finally {
    await browser.close();
  }
}
