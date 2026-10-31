import { supabase } from "./supabase";

export const CLEARED_AT_KEY = "cnd_panel_cleared_at";
export const PANEL_UPDATED_EVENT = "cnd-panel-updated";

export function getPanelClearedAt(): string | null {
  try {
    return localStorage.getItem(CLEARED_AT_KEY);
  } catch {
    return null;
  }
}

export function clearInterfaceOnly(): void {
  try {
    localStorage.setItem(CLEARED_AT_KEY, new Date().toISOString());
    window.dispatchEvent(new Event(PANEL_UPDATED_EVENT));
  } catch (e) {
    console.error("Erro ao limpar interface:", e);
  }
}

export function restoreInterfaceHistory(): void {
  try {
    localStorage.removeItem(CLEARED_AT_KEY);
    window.dispatchEvent(new Event(PANEL_UPDATED_EVENT));
  } catch (e) {
    console.error("Erro ao restaurar histórico na interface:", e);
  }
}

export async function clearInterfaceAndDatabase(): Promise<void> {
  // 1. Remove todos os itens de lotes no banco
  const { error: errItens } = await supabase
    .from("lote_itens")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");

  if (errItens) throw errItens;

  // 2. Remove todos os lotes no banco
  const { error: errLotes } = await supabase
    .from("lotes")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");

  if (errLotes) throw errLotes;

  // 3. Limpa o marcador local e notifica toda a interface
  try {
    localStorage.removeItem(CLEARED_AT_KEY);
  } catch {}
  window.dispatchEvent(new Event(PANEL_UPDATED_EVENT));
}
