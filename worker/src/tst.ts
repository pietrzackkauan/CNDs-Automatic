import { chromium } from "playwright";
import { GoogleGenAI } from "@google/genai";
import { supabase } from "./supabase";
import fs from "fs";
import path from "path";
import { analisarCertidaoBuffer } from "./pdf_analyzer";

export async function processarTST(cnpj: string): Promise<{ status: string; resultado: string; pdf_url?: string; mensagem_erro?: string }> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  console.log(`[TST] Iniciando processamento para o CNPJ: ${cnpj}`);
  
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    
    // 1. Acessar a página
    console.log(`[TST] Acessando portal do TST...`);
    await page.goto("https://cndt-certidao.tst.jus.br/gerarCertidao", { waitUntil: 'networkidle' });

    // 2. Preencher CNPJ
    await page.fill('#cpfCnpj', cnpj.replace(/[^\d]/g, ""));

    // 3. Resolver CAPTCHA com Gemini
    console.log(`[TST] Lendo imagem do CAPTCHA...`);
    const captchaElement = page.locator('img[src*="data:image"]'); // Pega a imagem base64
    const captchaBuffer = await captchaElement.screenshot();
    
    console.log(`[TST] Enviando CAPTCHA para o Gemini decifrar...`);
    let captchaText = "";
    
    // Tenta decifrar com fallback de modelos para máxima resiliência
    const modelsToTry = ["gemini-3.5-flash-lite", "gemini-3.8-flash"];
    for (const modelName of modelsToTry) {
      try {
        console.log(`[TST] Tentando decifrar com ${modelName}...`);
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            {
              role: 'user',
              parts: [
                { text: "Leia as letras e números deste CAPTCHA. Responda APENAS com os caracteres (sem espaços, sem pontuação, tudo minúsculo)." },
                { inlineData: { data: captchaBuffer.toString("base64"), mimeType: "image/png" } }
              ]
            }
          ]
        });
        
        captchaText = response.text?.trim().toLowerCase().replace(/\s/g, "") || "";
        if (captchaText.length > 2) {
          console.log(`[TST] Gemini (${modelName}) respondeu: ${captchaText}`);
          break;
        }
      } catch (geminiError: any) {
        console.warn(`[TST] Erro no Gemini (${modelName}):`, geminiError.message || geminiError);
      }
    }

    await page.fill('#captcha-resposta', captchaText);

    // 4. Clicar em Emitir e aguardar o PDF ou Erro
    console.log(`[TST] Solicitando emissão...`);
    
    // Configura um ouvinte para downloads (caso dê sucesso, ele baixa um PDF)
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
    
    await page.click('#botao-emitir');

    // Agora esperamos para ver se começou um download ou se apareceu alguma mensagem de erro na tela
    const download = await downloadPromise;

    if (download) {
      console.log(`[TST] Download de PDF detectado! Salvando...`);
      const tempPath = await download.path();
      if (!tempPath) throw new Error("Falha ao capturar o arquivo PDF baixado.");
      
      const fileBuffer = fs.readFileSync(tempPath);
      const fileName = `tst_${cnpj.replace(/[^\d]/g, "")}_${Date.now()}.pdf`;

      // Fazer upload para o Supabase Storage (bucket "certidoes")
      console.log(`[TST] Enviando PDF para o Supabase...`);
      const { data, error } = await supabase.storage
        .from('certidoes')
        .upload(fileName, fileBuffer, { contentType: 'application/pdf' });

      if (error) {
        throw new Error(`Erro ao salvar PDF no Supabase: ${error.message}`);
      }

      const { data: publicUrlData } = supabase.storage.from('certidoes').getPublicUrl(fileName);
      
      // Analisa o PDF da CNDT com o analisador universal
      const analise = await analisarCertidaoBuffer(fileBuffer, "TRABALHISTA");
      console.log(`[TST] Análise do PDF concluída: ${analise.resultado} | ${analise.detalhes}`);

      return { 
        status: "sucesso", 
        resultado: analise.resultado,
        pdf_url: publicUrlData.publicUrl,
        mensagem_erro: analise.detalhes || undefined
      };

    } else {
      // Se não baixou PDF, vamos ver se tem mensagem de erro na tela (ex: CAPTCHA inválido, ou "Empresa com débitos")
      console.log(`[TST] Nenhum PDF baixado. Analisando mensagens de erro na tela...`);
      const errorLocator = page.locator('.mensagens-erro, .ui-messages-error, span[style*="color:red"], span[style*="color: red"]');
      const errorText = await errorLocator.first().textContent({ timeout: 5000 }).catch(() => "Erro desconhecido ou CAPTCHA inválido.");
      
      if (errorText && errorText.toLowerCase().includes("caracteres")) {
         return { status: "erro", resultado: "FALHA CAPTCHA", mensagem_erro: "Gemini errou o CAPTCHA. Tente novamente." };
      }

      return { status: "erro", resultado: "FALHA NA EMISSÃO", mensagem_erro: errorText?.trim() };
    }

  } catch (error: any) {
    console.error(`[TST] Erro crítico no Playwright:`, error.message);
    return { status: "erro", resultado: "FALHA INTERNA", mensagem_erro: error.message };
  } finally {
    await browser.close();
  }
}
