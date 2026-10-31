import { useState } from "react";
import { Eraser, Trash2, AlertTriangle, ShieldCheck, X, Loader2 } from "lucide-react";
import { clearInterfaceOnly, clearInterfaceAndDatabase } from "../lib/clearPanel";

interface ClearActionsProps {
  onSuccess?: (message: string, mode: "interface" | "database") => void;
}

export function ClearActions({ onSuccess }: ClearActionsProps) {
  const [modalMode, setModalMode] = useState<"interface" | "database" | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleConfirm = async () => {
    if (!modalMode) return;
    setIsProcessing(true);

    try {
      if (modalMode === "interface") {
        clearInterfaceOnly();
        onSuccess?.("Painel limpo com sucesso! O histórico permanece salvo no banco de dados.", "interface");
      } else {
        await clearInterfaceAndDatabase();
        onSuccess?.("Interface e banco de dados limpos com sucesso!", "database");
      }
      setModalMode(null);
    } catch (e) {
      console.error("Erro ao executar limpeza:", e);
      onSuccess?.("Ocorreu um erro ao limpar os dados. Tente novamente.", modalMode);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={() => setModalMode("interface")}
          className="bg-secondary/70 hover:bg-secondary text-foreground border border-border px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all shadow-xs cursor-pointer"
        >
          <Eraser size={15} className="text-primary" />
          <span>Limpar Painel</span>
        </button>

        <button
          type="button"
          onClick={() => setModalMode("database")}
          className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all shadow-xs cursor-pointer"
        >
          <Trash2 size={15} />
          <span>Limpar Painel e Banco</span>
        </button>
      </div>

      {/* Modal de Confirmação */}
      {modalMode && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div
            className={`bg-card border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5 relative animate-in zoom-in-95 duration-200 ${
              modalMode === "database" ? "border-red-500/40" : "border-border"
            }`}
          >
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => setModalMode(null)}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>

            <div className="flex items-start gap-4">
              {modalMode === "interface" ? (
                <div className="w-11 h-11 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary shrink-0">
                  <Eraser size={22} />
                </div>
              ) : (
                <div className="w-11 h-11 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-500 shrink-0">
                  <AlertTriangle size={22} />
                </div>
              )}

              <div className="space-y-1 pr-4">
                <h3 className="text-base font-bold text-foreground">
                  {modalMode === "interface"
                    ? "Limpar apenas a Interface do Painel?"
                    : "Limpar Interface e Banco de Dados?"}
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {modalMode === "interface"
                    ? "Os contadores e a visualização atual da tela serão zerados para organizar seu ambiente para uma nova bateria de emissões."
                    : "Todos os lotes e certidões emitidas serão removidos da tela e excluídos permanentemente do banco de dados do sistema."}
                </p>
              </div>
            </div>

            {modalMode === "interface" ? (
              <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-xl p-3.5 flex items-start gap-2.5 text-xs text-emerald-300">
                <ShieldCheck size={16} className="text-emerald-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed">
                  <strong>Histórico preservado:</strong> Nenhum registro será apagado do banco de dados. Suas certidões anteriores continuarão salvas com segurança.
                </span>
              </div>
            ) : (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3.5 flex items-start gap-2.5 text-xs text-red-300">
                <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed">
                  <strong>Ação irreversível:</strong> O histórico de emissões será apagado definitivamente do banco de dados e não poderá ser desfeito.
                </span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => setModalMode(null)}
                className="bg-secondary hover:bg-secondary/80 text-foreground px-4 py-2.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={isProcessing}
                onClick={handleConfirm}
                className={`px-5 py-2.5 rounded-lg text-xs font-bold text-white flex items-center gap-2 transition-all cursor-pointer shadow-md disabled:opacity-50 ${
                  modalMode === "interface"
                    ? "bg-primary hover:opacity-90"
                    : "bg-red-600 hover:bg-red-500"
                }`}
              >
                {isProcessing && <Loader2 size={14} className="animate-spin" />}
                <span>{isProcessing ? "Limpando..." : "Continuar"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
