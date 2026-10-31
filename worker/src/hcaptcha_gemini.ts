import { Page } from "playwright";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

export async function solveHCaptchaWithGemini(page: Page, timeoutMs = 60000): Promise<boolean> {
  const startTime = Date.now();
  console.log("[HCAPTCHA-GEMINI] Verificando se há desafio hCaptcha na tela...");

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[HCAPTCHA-GEMINI] GEMINI_API_KEY não configurada.");
    return false;
  }

  const ai = new GoogleGenAI({ apiKey });
  const modelsToTry = ["gemini-3.8-flash", "gemini-3.5-flash-lite"];

  while (Date.now() - startTime < timeoutMs) {
    // Procura o iframe do desafio hCaptcha
    const challengeLocator = page.locator('iframe[title*="hCaptcha"], iframe[src*="frame=challenge"]');
    const isVisible = await challengeLocator.isVisible().catch(() => false);
    if (!isVisible) {
      // Se não há desafio visível, pode ter sido resolvido ou ainda não abriu
      const hasResponse = await page.evaluate(() => {
        const el = document.querySelector('[name="h-captcha-response"]') as HTMLTextAreaElement;
        return el && el.value.length > 20;
      }).catch(() => false);

      if (hasResponse) {
        console.log("[HCAPTCHA-GEMINI] hCaptcha resolvido com sucesso!");
        return true;
      }

      await page.waitForTimeout(1000);
      continue;
    }

    const frame = page.frameLocator('iframe[title*="hCaptcha"], iframe[src*="frame=challenge"]');
    const promptLocator = frame.locator('.prompt-text');
    const promptVisible = await promptLocator.isVisible({ timeout: 4000 }).catch(() => false);
    if (!promptVisible) {
      await page.waitForTimeout(1000);
      continue;
    }

    const promptText = (await promptLocator.innerText()).trim();
    console.log(`[HCAPTCHA-GEMINI] Instrução do desafio: "${promptText}"`);

    // Tira screenshot do container do desafio
    const screenshotBuffer = await challengeLocator.first().screenshot({ timeout: 5000 }).catch(() => null);
    if (!screenshotBuffer) {
      await page.waitForTimeout(1000);
      continue;
    }

    let matches: number[] = [];
    for (const model of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType: "image/png", data: screenshotBuffer.toString("base64") } },
                {
                  text: `Instruction: "${promptText}".
Look at the 3x3 grid of images in this challenge (indices 1 to 9, where row 1 has 1, 2, 3; row 2 has 4, 5, 6; row 3 has 7, 8, 9).
Identify which image tiles match the instruction.
Respond strictly in JSON format: {"matches": [numbers]}`
                }
              ]
            }
          ]
        });

        const text = response.text || "";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed.matches)) {
            matches = parsed.matches;
            break;
          }
        }
      } catch (err: any) {
        console.warn(`[HCAPTCHA-GEMINI] Falha com modelo ${model}:`, err.message);
      }
    }

    console.log(`[HCAPTCHA-GEMINI] Imagens identificadas para clicar:`, matches);
    const cells = frame.locator(".task-image");
    for (const idx of matches) {
      if (idx >= 1 && idx <= 9) {
        await cells.nth(idx - 1).click().catch(() => null);
        await page.waitForTimeout(250);
      }
    }

    // Clica no botão de avançar / verificar
    const submitBtn = frame.locator(".button-submit");
    const btnText = await submitBtn.innerText().catch(() => "");
    console.log(`[HCAPTCHA-GEMINI] Clicando no botão: "${btnText}"`);
    await submitBtn.click().catch(() => null);
    await page.waitForTimeout(2500);

    // Checa se já fechou ou se tem nova rodada
    const stillVisible = await challengeLocator.isVisible().catch(() => false);
    if (!stillVisible) {
      console.log("[HCAPTCHA-GEMINI] Desafio concluído e fechado!");
      return true;
    }
  }

  return false;
}
