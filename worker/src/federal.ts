import { chromium } from "playwright";
import { supabase } from "./supabase";
import { analisarCertidaoBuffer } from "./pdf_analyzer";
import { obterCertificadoPrincipal } from "./certs";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";

export async function processarFederal(cnpj: string, perfilCert?: string): Promise<{
  status: string;
  resultado: string;
  pdf_url?: string;
  mensagem_erro?: string;
}> {
  console.log(`[FEDERAL] Iniciando processamento para o CNPJ: ${cnpj} (100% sem assinaturas pagas)`);

  const cleanCnpj = cnpj.replace(/[^\d]/g, "");

  // 1. Garantir que o Chrome em Modo Conectado (porta 9222) está disponível
  let cdpRes = await fetch("http://127.0.0.1:9222/json/version").catch(() => null);

  if (!cdpRes || !cdpRes.ok) {
    console.log(`[FEDERAL] Chrome não detectado na porta 9222.`);
    return {
      status: "erro",
      resultado: "CHROME DESCONECTADO",
      mensagem_erro: "Google Chrome não detectado na porta 9222. Abra o atalho 'Iniciar Chrome CND' na sua Área de Trabalho e tente novamente."
    };
  }

  if (cdpRes && cdpRes.ok) {
    console.log(`[FEDERAL] Conectando ao Chrome via CDP na porta 9222...`);
    const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
    const contexts = browser.contexts();
    const context = contexts[0] || browser;
    const page = await context.newPage();

    let pdfBufferFromApi: Buffer | null = null;
    let apiStatusEmissao: string | null = null;
    let apiMensagemTexto: string | null = null;

    // Helper para buscar certidão válida emitida nos últimos 180 dias
    async function obterCertidaoValidaDoAcervo() {
      const centoEOitentaDiasAtras = new Date();
      centoEOitentaDiasAtras.setDate(centoEOitentaDiasAtras.getDate() - 180);

      const { data: prev } = await supabase
        .from('lote_itens')
        .select('id, resultado, pdf_url, created_at, lotes!inner(portal), empresas!inner(cnpj)')
        .or(`cnpj.eq.${cnpj},cnpj.eq.${cleanCnpj}`, { foreignTable: 'empresas' })
        .eq('lotes.portal', 'FEDERAL')
        .eq('status', 'sucesso')
        .not('pdf_url', 'is', null)
        .gte('created_at', centoEOitentaDiasAtras.toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      return prev;
    }

    // Monitora respostas JSON da API oficial da Receita Federal
    page.on("response", async (res) => {
      const url = res.url();
      if (url.includes("api/Emissao") || url.includes("verificar")) {
        try {
          const body = await res.json();
          if (body.statusEmissao) {
            apiStatusEmissao = body.statusEmissao;
          }
          const msg = typeof body.mensagem === "string"
            ? body.mensagem
            : (body.mensagem?.texto || (Array.isArray(body.mensagens) ? body.mensagens.join(" ") : null));
          if (msg) {
            apiMensagemTexto = msg;
          }
          if (body.pdf && typeof body.pdf === "string") {
            pdfBufferFromApi = Buffer.from(body.pdf, "base64");
            console.log(`[FEDERAL API] PDF recebido em Base64 (${pdfBufferFromApi.length} bytes)!`);
          }
        } catch (e) {}
      }
    });

    try {
      console.log(`[FEDERAL] Acessando portal oficial da Receita Federal...`);
      await page.goto("https://servicos.receitafederal.gov.br/servico/certidoes/#/home/cnpj", {
        waitUntil: "domcontentloaded",
        timeout: 25000
      });

      // Aguarda o campo de CNPJ carregar
      await page.waitForSelector("input[name='niContribuinte']", { timeout: 15000 }).catch(() => null);

      // Aceita cookies se visível
      const aceitarBtn = page.locator("button:has-text('Aceitar')");
      if ((await aceitarBtn.count()) > 0 && (await aceitarBtn.isVisible())) {
        await aceitarBtn.click().catch(() => null);
        await page.waitForTimeout(300);
      }

      // Preenche CNPJ
      const input = page.locator("input[name='niContribuinte']");
      await input.click();
      await input.pressSequentially(cleanCnpj, { delay: 30 });
      await page.waitForTimeout(600);

      // Prepara listener de download caso o navegador acione download direto de arquivo
      const downloadPromise = page.waitForEvent("download", { timeout: 25000 }).catch(() => null);

      console.log(`[FEDERAL] Clicando em Emitir Certidão para CNPJ ${cleanCnpj}...`);
      await page.locator("button:has-text('Emitir Certidão')").first().click();
      await page.waitForTimeout(3000);

      // 1. Verifica se apareceu modal de "Certidão Válida Encontrada"
      const modalText = await page.locator(".modal, [role='dialog'], .dialog, .ui-dialog").innerText().catch(() => "");
      const isCertidaoValidaEncontrada = modalText.includes("Certidão Válida Encontrada") || modalText.includes("Já existe uma certidão válida");

      if (isCertidaoValidaEncontrada) {
        console.log(`[FEDERAL] Portal da Receita Federal confirmou: Já existe uma certidão válida ativa para o CNPJ ${cleanCnpj}.`);
        const previousSuccess = await obterCertidaoValidaDoAcervo();
        if (previousSuccess && previousSuccess.pdf_url) {
          console.log(`[FEDERAL] Certidão ativa reaproveitada com sucesso do acervo: ${previousSuccess.pdf_url}`);
          return {
            status: "sucesso",
            resultado: previousSuccess.resultado || "NEGATIVA",
            pdf_url: previousSuccess.pdf_url,
            mensagem_erro: "Certidão válida já emitida e ativa na Receita Federal."
          };
        }
      }

      // 2. Aguarda processamento ou download (até 15 segundos)
      for (let i = 0; i < 8; i++) {
        if (pdfBufferFromApi) break;
        await page.waitForTimeout(1500);

        const btnDownload = page.locator("button:has-text('Emitir 2ª Via'), button:has-text('Visualizar'), a[download]").first();
        if ((await btnDownload.count()) > 0 && (await btnDownload.isVisible())) {
          console.log(`[FEDERAL] Botão de download localizado. Clicando...`);
          await btnDownload.click().catch(() => null);
          break;
        }
      }

      const download = await downloadPromise;
      let finalBuffer: Buffer | null = pdfBufferFromApi;

      if (!finalBuffer && download) {
        const tempPath = await download.path();
        finalBuffer = fs.readFileSync(tempPath);
      }

      // Se obtivemos o PDF oficial emitido
      if (finalBuffer && finalBuffer.length > 100) {
        console.log(`[FEDERAL] Upload do PDF para Supabase Storage...`);
        const fileName = `cnd_federal_${cleanCnpj}_${Date.now()}.pdf`;

        const { error: uploadError } = await supabase.storage
          .from("certidoes")
          .upload(fileName, finalBuffer, { contentType: "application/pdf" });

        if (uploadError) throw uploadError;
        const { data: publicUrlData } = supabase.storage.from("certidoes").getPublicUrl(fileName);

        const analise = await analisarCertidaoBuffer(finalBuffer, "FEDERAL");

        return {
          status: "sucesso",
          resultado: analise.resultado,
          pdf_url: publicUrlData.publicUrl,
          mensagem_erro: analise.detalhes || undefined
        };
      }

      // Se não gerou PDF imediato, analisa o status e textos da Receita Federal
      const bodyText = (await page.innerText("body").catch(() => "")).toUpperCase();
      const alertText = (await page.locator(".toast, .alert, .snackbar, .notification, .msg-erro, .text-danger, .p-toast").innerText().catch(() => "")).toUpperCase();
      const fullText = (bodyText + " " + alertText + " " + (apiMensagemTexto || "")).toUpperCase();

      // Se for instabilidade ou bloqueio de duplicidade 105/106, verifica se já existe certidão válida recente
      if (fullText.includes("106") || fullText.includes("105") || fullText.includes("CERTIDÃO VÁLIDA") || fullText.includes("JÁ EXISTE")) {
        const previousSuccess = await obterCertidaoValidaDoAcervo();
        if (previousSuccess && previousSuccess.pdf_url) {
          console.log(`[FEDERAL] Certidão ativa reaproveitada após bloqueio de reemissão: ${previousSuccess.pdf_url}`);
          return {
            status: "sucesso",
            resultado: previousSuccess.resultado || "NEGATIVA",
            pdf_url: previousSuccess.pdf_url,
            mensagem_erro: "Certidão válida já emitida e ativa na Receita Federal."
          };
        }
      }

      if (fullText.includes("ESTAMOS ANALISANDO SEU PEDIDO") || apiStatusEmissao === "EmProcessamento") {
        return {
          status: "sucesso",
          resultado: "EM ANÁLISE NA RFB",
          mensagem_erro: "Pedido acolhido pela Receita Federal. O sistema da RFB está processando a certidão em segundo plano."
        };
      }

      if (fullText.includes("INSUFICIENTE") || fullText.includes("INSUFICIENTES")) {
        return {
          status: "alerta",
          resultado: "PENDÊNCIA FISCAL / CADASTRAL",
          mensagem_erro: apiMensagemTexto || "As informações na Receita Federal/PGFN são insuficientes para emissão online (necessário regularizar pendências no e-CAC)."
        };
      }

      if (fullText.includes("PENDÊNCIAS") || fullText.includes("DÉBITO") || fullText.includes("POSITIVA")) {
        return {
          status: "sucesso",
          resultado: "POSITIVA",
          mensagem_erro: "Contribuinte possui débitos ou pendências na Receita Federal / PGFN."
        };
      }

      if (fullText.includes("NÃO EXISTE CERTIDÃO") || fullText.includes("CERTIDAONAOENCONTRADA")) {
        return {
          status: "erro",
          resultado: "SEM CERTIDÃO",
          mensagem_erro: "Não foi localizada certidão no histórico da Receita Federal."
        };
      }

      // Fallback: se não houve PDF novo gerado mas o contribuinte já tem CND válida e ativa no acervo (emitida < 180 dias)
      const existingSuccess = await obterCertidaoValidaDoAcervo();
      if (existingSuccess && existingSuccess.pdf_url) {
        console.log(`[FEDERAL] Certidão ativa válida identificada no acervo: ${existingSuccess.pdf_url}`);
        return {
          status: "sucesso",
          resultado: existingSuccess.resultado || "NEGATIVA",
          pdf_url: existingSuccess.pdf_url,
          mensagem_erro: "Certidão válida ativa reaproveitada do acervo (Receita Federal dispensa nova emissão)."
        };
      }

      return {
        status: "erro",
        resultado: "FALHA NA EMISSÃO",
        mensagem_erro: apiMensagemTexto || "Não foi possível emitir a certidão no portal da Receita Federal."
      };
    } finally {
      await page.close().catch(() => null);
    }
  }

  return {
    status: "erro",
    resultado: "CHROME DESCONECTADO",
    mensagem_erro: "Não foi possível conectar ao Google Chrome. Execute iniciar-chrome-cnd.bat."
  };
}
