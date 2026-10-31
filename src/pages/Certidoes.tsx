import { CheckCircle2, XCircle, Clock, Download, Search, Filter, RotateCcw, FileText, AlertTriangle, Calendar, Database, Eye } from "lucide-react";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "../lib/supabase";
import { ClearActions } from "../components/ClearActions";
import { getPanelClearedAt, restoreInterfaceHistory, PANEL_UPDATED_EVENT } from "../lib/clearPanel";

// Função para remover acentos e padronizar textos em português
function normalizar(texto: string = ""): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isItemNegativa(item: any): boolean {
  const res = String(item.resultado || "").toUpperCase();
  return (
    item.status === "sucesso" &&
    ((res.includes("NEGATIVA") && !res.includes("POSITIVA")) || res === "REGULAR")
  );
}

function isItemPositiva(item: any): boolean {
  const res = String(item.resultado || "").toUpperCase();
  return (
    res.includes("POSITIVA") ||
    res.includes("PENDÊNCIA") ||
    res.includes("PENDENCIA") ||
    res.includes("IRREGULAR") ||
    item.status === "alerta"
  );
}

function isItemErro(item: any): boolean {
  const res = String(item.resultado || "").toUpperCase();
  return item.status === "erro" && !res.includes("PENDÊNCIA") && !res.includes("PENDENCIA");
}

function isDateToken(token: string): boolean {
  const t = token.trim();
  return /^\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?$/.test(t) || /^\d{4}-\d{2}-\d{2}$/.test(t);
}

function matchDateToken(token: string, isoCreatedAt: string): boolean {
  if (!isoCreatedAt) return false;
  const d = new Date(isoCreatedAt);
  if (isNaN(d.getTime())) return false;

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear());
  const shortYear = year.slice(-2);

  const t = token.trim();

  // Formato ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return `${year}-${month}-${day}` === t;
  }

  // Formatos DD/MM/YYYY, DD-MM-YYYY, DD/MM/YY ou DD/MM
  const parts = t.split(/[\/\-]/);
  const pDay = parts[0].padStart(2, "0");
  const pMonth = parts[1].padStart(2, "0");

  if (pDay !== day || pMonth !== month) return false;

  if (parts.length >= 3 && parts[2]) {
    const pYear = parts[2];
    if (pYear.length === 2) {
      return pYear === shortYear;
    }
    return pYear === year;
  }

  return true;
}

function matchSingleFactor(rawFactor: string, item: any): boolean {
  const factor = rawFactor.trim();
  if (!factor) return true;

  const norm = normalizar(factor);

  // 1. Checagem se o fator é uma Data de Emissão (ex: 31/10/2026, 31/10, 2026-10-31)
  if (isDateToken(factor)) {
    return matchDateToken(factor, item.created_at);
  }

  // 2. Checagem se o fator é um Portal específico
  const portal = String(item.lotes?.portal || "").toUpperCase();
  if (["estadual", "estaduais", "sefaz"].includes(norm)) {
    return portal === "ESTADUAL";
  }
  if (["federal", "federais", "receita", "pgfn", "rfb"].includes(norm)) {
    return portal === "FEDERAL";
  }
  if (["trabalhista", "trabalhistas", "tst", "cndt"].includes(norm)) {
    return portal === "TRABALHISTA";
  }
  if (["caixa", "fgts", "crf"].includes(norm)) {
    return portal === "CAIXA";
  }
  if (["municipal", "municipais", "prefeitura", "prefeituras"].includes(norm)) {
    return portal === "MUNICIPAL";
  }

  // 3. Checagem se o fator é uma Situação / Resultado
  if (["negativa", "negativas", "regular", "regulares", "cnd negativa"].includes(norm)) {
    return isItemNegativa(item);
  }
  if (
    [
      "positiva",
      "positivas",
      "pendencia",
      "pendencias",
      "alerta",
      "alertas",
      "irregular",
      "irregulares",
      "debito",
      "debitos"
    ].includes(norm)
  ) {
    return isItemPositiva(item);
  }
  if (["positiva com efeito", "efeito de negativa", "efeitos de negativa", "positiva com efeitos"].includes(norm)) {
    return String(item.resultado || "").toUpperCase().includes("EFEITO");
  }
  if (["erro", "erros", "falha", "falhas"].includes(norm)) {
    return isItemErro(item);
  }
  if (["cancelada", "canceladas", "cancelado", "cancelados"].includes(norm)) {
    return item.status === "cancelado";
  }
  if (["andamento", "em andamento", "processando", "pendente", "pendentes", "fila"].includes(norm)) {
    return item.status === "processando" || item.status === "pendente";
  }

  // 4. Checagem por Nome da Empresa, CNPJ, Município, Inscrição Municipal ou Detalhes da Certidão
  const nomeNorm = normalizar(item.empresas?.nome || "");
  const cnpjOriginal = String(item.empresas?.cnpj || "");
  const cnpjDigits = cnpjOriginal.replace(/\D/g, "");
  const municipioNorm = normalizar(item.empresas?.municipio || "");
  const imOriginal = String(item.empresas?.inscricao_municipal || "");
  const imDigits = imOriginal.replace(/\D/g, "");
  const msgNorm = normalizar(item.mensagem_erro || "");
  const resNorm = normalizar(item.resultado || "");
  const portalNorm = normalizar(portal);
  const dataFormatada = item.created_at ? new Date(item.created_at).toLocaleDateString("pt-BR") : "";

  const factorDigits = factor.replace(/\D/g, "");

  const matchNome = nomeNorm.includes(norm);
  const matchCnpj = (factorDigits.length > 0 && cnpjDigits.includes(factorDigits)) || cnpjOriginal.includes(factor);
  const matchMunicipio = municipioNorm.includes(norm);
  const matchIm = (factorDigits.length > 0 && imDigits.includes(factorDigits)) || (Boolean(imOriginal) && imOriginal.includes(factor));
  const matchMsg = msgNorm.includes(norm) || resNorm.includes(norm) || portalNorm.includes(norm);
  const matchDataStr = dataFormatada.includes(factor);

  return matchNome || matchCnpj || matchMunicipio || matchIm || matchMsg || matchDataStr;
}

export function Certidoes() {
  const [itens, setItens] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [isCancelingAll, setIsCancelingAll] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [clearedAt, setClearedAt] = useState<string | null>(() => getPanelClearedAt());
  const [viewingSavedHistory, setViewingSavedHistory] = useState(false);

  // Filtros de busca
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"TODOS" | "NEGATIVA" | "POSITIVA" | "PROCESSANDO" | "ERRO" | "CANCELADO">("TODOS");
  const [portalFilter, setPortalFilter] = useState<string>("TODOS");
  const [dateFilter, setDateFilter] = useState<string>("");

  // Busca os dados no Supabase
  const fetchItens = async () => {
    try {
      const { data, error } = await supabase
        .from('lote_itens')
        .select(`
          *,
          empresas (nome, cnpj, municipio, inscricao_municipal),
          lotes (portal)
        `)
        .order('created_at', { ascending: false });

      if (!error && data) {
        setItens(data);
      }
    } catch (e) {
      console.error("Erro ao carregar acervo de certidões:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelItem = async (itemId: string) => {
    try {
      setCancelingId(itemId);
      const { error } = await supabase
        .from('lote_itens')
        .update({
          status: 'cancelado',
          resultado: 'CANCELADO',
          mensagem_erro: 'Cancelado pelo usuário.'
        })
        .eq('id', itemId);

      if (error) throw error;
      await fetchItens();
    } catch (e) {
      console.error("Erro ao cancelar emissão:", e);
    } finally {
      setCancelingId(null);
    }
  };

  const handleCancelAll = async () => {
    try {
      setIsCancelingAll(true);
      const { error } = await supabase
        .from('lote_itens')
        .update({
          status: 'cancelado',
          resultado: 'CANCELADO',
          mensagem_erro: 'Cancelado pelo usuário.'
        })
        .in('status', ['pendente', 'processando']);

      if (error) throw error;
      await fetchItens();
    } catch (e) {
      console.error("Erro ao cancelar todas as emissões:", e);
    } finally {
      setIsCancelingAll(false);
    }
  };

  useEffect(() => {
    fetchItens();
    const interval = setInterval(fetchItens, 3000);
    const handlePanelUpdated = () => {
      setClearedAt(getPanelClearedAt());
      setViewingSavedHistory(false);
      fetchItens();
    };
    window.addEventListener(PANEL_UPDATED_EVENT, handlePanelUpdated);
    return () => {
      clearInterval(interval);
      window.removeEventListener(PANEL_UPDATED_EVENT, handlePanelUpdated);
    };
  }, []);

  // Lista base considerando se o painel foi limpo (apenas interface)
  const activeItens = useMemo(() => {
    if (!clearedAt || viewingSavedHistory) return itens;
    const clearTime = new Date(clearedAt).getTime();
    return itens.filter((i) => new Date(i.created_at).getTime() > clearTime);
  }, [itens, clearedAt, viewingSavedHistory]);

  const hiddenHistoryCount = useMemo(() => {
    if (!clearedAt) return 0;
    const clearTime = new Date(clearedAt).getTime();
    return itens.filter((i) => new Date(i.created_at).getTime() <= clearTime).length;
  }, [itens, clearedAt]);

  // Fatores combinados digitados na barra de pesquisa (separados por ";")
  const searchFactors = useMemo(() => {
    return searchTerm
      .split(";")
      .map((f) => f.trim())
      .filter(Boolean);
  }, [searchTerm]);

  // Filtragem combinada (Fatores com ";" + Portal + Data + Situação)
  const filteredItens = useMemo(() => {
    return activeItens.filter((item) => {
      // 1. Combinação de fatores digitados na barra de busca (ex: "Estaduais ; 31/10/2026 ; negativas")
      if (searchFactors.length > 0) {
        const allMatched = searchFactors.every((factor) => matchSingleFactor(factor, item));
        if (!allMatched) return false;
      }

      // 2. Filtro por Portal no seletor
      if (portalFilter !== "TODOS") {
        if (item.lotes?.portal !== portalFilter) return false;
      }

      // 3. Filtro por Data de Emissão no calendário (YYYY-MM-DD)
      if (dateFilter) {
        if (!matchDateToken(dateFilter, item.created_at)) return false;
      }

      // 4. Filtro pelas pílulas de Situação
      if (statusFilter !== "TODOS") {
        if (statusFilter === "NEGATIVA") {
          if (!isItemNegativa(item)) return false;
        } else if (statusFilter === "POSITIVA") {
          if (!isItemPositiva(item)) return false;
        } else if (statusFilter === "PROCESSANDO") {
          if (item.status !== "processando" && item.status !== "pendente") return false;
        } else if (statusFilter === "ERRO") {
          if (!isItemErro(item)) return false;
        } else if (statusFilter === "CANCELADO") {
          if (item.status !== "cancelado") return false;
        }
      }

      return true;
    });
  }, [activeItens, searchFactors, statusFilter, portalFilter, dateFilter]);

  // Contagens para as abas rápidas
  const counts = useMemo(() => {
    return {
      total: activeItens.length,
      negativas: activeItens.filter(isItemNegativa).length,
      positivas: activeItens.filter(isItemPositiva).length,
      processando: activeItens.filter(i => i.status === "processando" || i.status === "pendente").length,
      erros: activeItens.filter(isItemErro).length,
      canceladas: activeItens.filter(i => i.status === "cancelado").length,
    };
  }, [activeItens]);

  const limparFiltros = () => {
    setSearchTerm("");
    setStatusFilter("TODOS");
    setPortalFilter("TODOS");
    setDateFilter("");
  };

  const hasFiltrosAtivos = searchTerm !== "" || statusFilter !== "TODOS" || portalFilter !== "TODOS" || dateFilter !== "";

  const getStatusBadge = (status: string, resultado: string) => {
    if (status === 'pendente') {
      return <span className="bg-yellow-500/10 text-yellow-500 border border-yellow-500/30 px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1.5 w-fit"><Clock size={12}/> PENDENTE</span>;
    }
    if (status === 'processando') {
      return <span className="bg-blue-500/10 text-blue-500 border border-blue-500/30 px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1.5 w-fit animate-pulse"><Clock size={12}/> PROCESSANDO</span>;
    }
    if (status === 'cancelado') {
      return <span className="bg-zinc-500/10 text-zinc-400 border border-zinc-500/30 px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1.5 w-fit"><XCircle size={12}/> CANCELADO</span>;
    }
    if (status === 'alerta' || resultado?.includes("PENDÊNCIA") || resultado?.includes("PENDENCIA") || resultado?.includes("INSUFICIENTE") || resultado?.includes("NÃO CADASTRAD") || resultado?.includes("PORTAL") || resultado?.includes("CIDADE NÃO MAPEADA") || resultado?.includes("FALTA")) {
      return <span className="bg-amber-500/10 text-amber-500 border border-amber-500/30 px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1.5 w-fit"><AlertTriangle size={12}/> {resultado || "PENDÊNCIA / ATENÇÃO"}</span>;
    }
    if (status === 'erro') {
      return <span className="bg-red-500/10 text-red-500 border border-red-500/30 px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1.5 w-fit"><XCircle size={12}/> {resultado || "ERRO"}</span>;
    }
    
    if ((resultado?.includes("NEGATIVA") && !resultado?.includes("POSITIVA")) || resultado === "REGULAR") {
      return <span className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1.5 w-fit"><CheckCircle2 size={12}/> {resultado}</span>;
    }
    const labelPositiva = !resultado ? "POSITIVA" : resultado;
    return <span className="bg-amber-500/10 text-amber-500 border border-amber-500/30 px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1.5 w-fit"><AlertTriangle size={12}/> {labelPositiva}</span>;
  };

  const formatarData = (isoDate: string) => {
    if (!isoDate) return "-";
    const d = new Date(isoDate);
    return `${d.toLocaleDateString("pt-BR")} às ${d.toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 relative">
      
      {toastMessage && (
        <div className="fixed bottom-8 right-8 bg-green-600 text-white px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom-8 fade-in z-50">
          <CheckCircle2 size={20} />
          <span className="font-medium text-sm">{toastMessage}</span>
        </div>
      )}

      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="text-primary" size={26} />
            Acervo de Certidões Emitidas
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Localize e baixe qualquer CND combinando portal, data de emissão, situação, nome ou CNPJ.
          </p>
        </div>

        <ClearActions
          onSuccess={(msg) => {
            setClearedAt(getPanelClearedAt());
            setViewingSavedHistory(false);
            fetchItens();
            setToastMessage(msg);
            setTimeout(() => setToastMessage(""), 4500);
          }}
        />
      </div>

      {/* Aviso discreto quando o Painel foi limpo mas há histórico salvo no banco */}
      {clearedAt && hiddenHistoryCount > 0 && (
        <div className="bg-secondary/40 border border-border rounded-xl px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5 text-muted-foreground">
            <Database size={15} className="text-primary shrink-0" />
            <span>
              {viewingSavedHistory ? (
                <>Exibindo todo o histórico salvo no banco de dados (<strong>{itens.length}</strong> registros).</>
              ) : (
                <>Painel limpo. Existem <strong>{hiddenHistoryCount}</strong> certidões anteriores preservadas no histórico do banco de dados.</>
              )}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setViewingSavedHistory(!viewingSavedHistory)}
              className="bg-background hover:bg-secondary text-foreground border border-border px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Eye size={13} className="text-primary" />
              <span>{viewingSavedHistory ? "Ocultar Histórico Antigo" : "Consultar Histórico Salvo"}</span>
            </button>
            {viewingSavedHistory && (
              <button
                type="button"
                onClick={() => {
                  restoreInterfaceHistory();
                  setClearedAt(null);
                  setViewingSavedHistory(false);
                }}
                className="bg-primary/15 hover:bg-primary/25 text-primary border border-primary/30 px-3 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer"
              >
                Restaurar Tudo no Painel
              </button>
            )}
          </div>
        </div>
      )}

      {/* Banner de Processamento Ativo com Botão Cancelar Tudo */}
      {counts.processando > 0 && (
        <div className="bg-blue-950/40 border border-blue-500/40 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm animate-in fade-in duration-300">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3.5 w-3.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-blue-500"></span>
            </span>
            <div>
              <p className="text-sm font-bold text-foreground flex items-center gap-2">
                <span>{counts.processando} {counts.processando === 1 ? 'certidão está sendo gerada agora' : 'certidões em andamento/fila'}</span>
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                O robô está trabalhando na emissão. Você pode interromper uma empresa individualmente na tabela ou cancelar todas de uma vez.
              </p>
            </div>
          </div>

          <button
            onClick={handleCancelAll}
            disabled={isCancelingAll}
            className="w-full sm:w-auto bg-red-600/90 hover:bg-red-600 text-white text-xs font-bold px-4 py-2.5 rounded-lg transition-all flex items-center justify-center gap-2 shadow-sm shrink-0 cursor-pointer disabled:opacity-50"
          >
            <XCircle size={15} />
            <span>{isCancelingAll ? "Cancelando todas..." : "CANCELAR TODAS AS EMISSÕES"}</span>
          </button>
        </div>
      )}

      {/* Caixa de Busca Principal */}
      <div className="bg-card border border-border rounded-xl p-4 sm:p-5 shadow-sm space-y-4">
        
        <div className="flex flex-col lg:flex-row gap-3">
          {/* Campo de pesquisa multi-fator */}
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
            <input 
              type="text" 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Pesquise por Empresa, CNPJ ou combine fatores com ';' (ex: Estaduais ; 31/10/2026 ; negativas)..." 
              className="w-full bg-background border border-border rounded-lg pl-10 pr-4 py-2.5 text-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-all placeholder:text-muted-foreground/70"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Seletor de Data de Emissão */}
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" size={14} />
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                aria-label="Filtrar por data de emissão"
                title="Filtrar pela data da emissão"
                className="bg-background border border-border rounded-lg pl-9 pr-3 py-2.5 text-sm font-medium focus:border-primary focus:outline-none cursor-pointer text-foreground"
              />
            </div>

            {/* Seletor de Portal */}
            <div className="relative min-w-[170px]">
              <select
                value={portalFilter}
                onChange={(e) => setPortalFilter(e.target.value)}
                aria-label="Filtrar por portal"
                className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm font-medium focus:border-primary focus:outline-none cursor-pointer text-foreground appearance-none pr-8"
              >
                <option value="TODOS">Todos os Portais</option>
                <option value="FEDERAL">Federal (Receita/PGFN)</option>
                <option value="ESTADUAL">Estadual (SEFAZ)</option>
                <option value="TRABALHISTA">Trabalhista (TST)</option>
                <option value="CAIXA">FGTS (Caixa)</option>
                <option value="MUNICIPAL">Municipal</option>
              </select>
              <Filter className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" size={14} />
            </div>

            {hasFiltrosAtivos && (
              <button 
                onClick={limparFiltros}
                title="Limpar filtros"
                className="bg-secondary/60 hover:bg-secondary text-muted-foreground hover:text-foreground px-3 py-2.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors border border-border cursor-pointer"
              >
                <RotateCcw size={14} />
                <span className="hidden sm:inline">Limpar</span>
              </button>
            )}
          </div>
        </div>

        {/* Dica discreta ou Pílulas dos fatores combinados ativos */}
        {searchFactors.length > 1 ? (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground font-medium mr-1">Fatores combinados:</span>
            {searchFactors.map((factor, idx) => (
              <span
                key={idx}
                className="bg-primary/15 text-primary border border-primary/30 px-2.5 py-0.5 rounded-md font-semibold"
              >
                {factor}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Dica: Você pode combinar filtros usando <strong>;</strong> — exemplo: <code className="text-foreground/90 bg-secondary/60 px-1.5 py-0.5 rounded">Estaduais ; positivas</code> ou <code className="text-foreground/90 bg-secondary/60 px-1.5 py-0.5 rounded">Estaduais ; 31/10/2026 ; negativas</code>
          </p>
        )}

        {/* Pílulas de Status Rápidas */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/50">
          <span className="text-xs font-semibold text-muted-foreground mr-1 uppercase tracking-wider">Situação:</span>

          <button
            onClick={() => setStatusFilter("TODOS")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border cursor-pointer ${
              statusFilter === "TODOS"
                ? "bg-foreground text-background border-foreground font-semibold shadow-sm"
                : "bg-background text-muted-foreground border-border hover:bg-secondary/40"
            }`}
          >
            Todas ({counts.total})
          </button>

          <button
            onClick={() => setStatusFilter("NEGATIVA")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border cursor-pointer ${
              statusFilter === "NEGATIVA"
                ? "bg-emerald-500 text-white border-emerald-500 font-semibold shadow-sm"
                : "bg-background text-emerald-600 dark:text-emerald-400 border-border hover:bg-emerald-500/10"
            }`}
          >
            <CheckCircle2 size={13} />
            Negativas ({counts.negativas})
          </button>

          <button
            onClick={() => setStatusFilter("POSITIVA")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border cursor-pointer ${
              statusFilter === "POSITIVA"
                ? "bg-amber-500 text-white border-amber-500 font-semibold shadow-sm"
                : "bg-background text-amber-600 dark:text-amber-400 border-border hover:bg-amber-500/10"
            }`}
          >
            <AlertTriangle size={13} />
            Positivas / Pendências ({counts.positivas})
          </button>

          <button
            onClick={() => setStatusFilter("PROCESSANDO")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border cursor-pointer ${
              statusFilter === "PROCESSANDO"
                ? "bg-blue-500 text-white border-blue-500 font-semibold shadow-sm"
                : "bg-background text-blue-600 dark:text-blue-400 border-border hover:bg-blue-500/10"
            }`}
          >
            <Clock size={13} />
            Em Andamento ({counts.processando})
          </button>

          <button
            onClick={() => setStatusFilter("ERRO")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border cursor-pointer ${
              statusFilter === "ERRO"
                ? "bg-red-500 text-white border-red-500 font-semibold shadow-sm"
                : "bg-background text-red-600 dark:text-red-400 border-border hover:bg-red-500/10"
            }`}
          >
            <XCircle size={13} />
            Erros ({counts.erros})
          </button>

          <button
            onClick={() => setStatusFilter("CANCELADO")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border cursor-pointer ${
              statusFilter === "CANCELADO"
                ? "bg-zinc-600 text-white border-zinc-600 font-semibold shadow-sm"
                : "bg-background text-zinc-400 border-border hover:bg-zinc-500/10"
            }`}
          >
            <XCircle size={13} />
            Canceladas ({counts.canceladas})
          </button>
        </div>
      </div>

      {/* Tabela de Resultados */}
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        
        {/* Barra superior com indicador de contagem */}
        <div className="px-6 py-3.5 border-b border-border bg-secondary/15 flex flex-wrap justify-between items-center gap-2 text-xs text-muted-foreground font-medium">
          <span>
            Mostrando <strong className="text-foreground">{filteredItens.length}</strong> de <strong className="text-foreground">{activeItens.length}</strong> certidões
          </span>
          {(searchTerm || dateFilter) && (
            <span className="text-primary font-medium">
              Filtro ativo: {[searchTerm, dateFilter && dateFilter.split("-").reverse().join("/")].filter(Boolean).join(" • ")}
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground bg-secondary/30 uppercase border-b border-border">
              <tr>
                <th className="px-6 py-4 font-medium">Empresa</th>
                <th className="px-6 py-4 font-medium">CNPJ</th>
                <th className="px-6 py-4 font-medium">Portal</th>
                <th className="px-6 py-4 font-medium">Data de Emissão</th>
                <th className="px-6 py-4 font-medium">Resultado</th>
                <th className="px-6 py-4 font-medium text-right">Certidão (PDF)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-muted-foreground">
                    Carregando certidões...
                  </td>
                </tr>
              ) : filteredItens.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-muted-foreground">
                    <div className="space-y-2">
                      <p className="text-base font-semibold text-foreground">Nenhuma certidão localizada</p>
                      <p className="text-xs max-w-md mx-auto">
                        {hasFiltrosAtivos
                          ? "Não encontramos nenhuma certidão com a combinação de filtros informada."
                          : clearedAt && hiddenHistoryCount > 0
                          ? "O painel foi limpo para a sessão atual. O histórico anterior permanece salvo no banco de dados."
                          : "Nenhuma certidão cadastrada até o momento. Processe um lote no Painel para gerar o acervo."}
                      </p>
                      <div className="flex items-center justify-center gap-2 pt-2">
                        {hasFiltrosAtivos && (
                          <button
                            onClick={limparFiltros}
                            className="text-xs bg-primary text-primary-foreground px-3.5 py-1.5 rounded-lg font-medium hover:opacity-90 transition-opacity inline-flex items-center gap-1.5 shadow-sm cursor-pointer"
                          >
                            <RotateCcw size={13} /> Limpar Busca e Filtros
                          </button>
                        )}
                        {clearedAt && !viewingSavedHistory && hiddenHistoryCount > 0 && (
                          <button
                            onClick={() => setViewingSavedHistory(true)}
                            className="text-xs bg-secondary hover:bg-secondary/80 text-foreground border border-border px-3.5 py-1.5 rounded-lg font-medium transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <Eye size={13} /> Consultar Histórico ({hiddenHistoryCount})
                          </button>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredItens.map((item) => (
                  <tr key={item.id} className="hover:bg-secondary/20 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-foreground">{item.empresas?.nome || "Empresa sem nome"}</div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground/80 mt-0.5">
                        {item.empresas?.municipio && <span>{item.empresas?.municipio}</span>}
                        {item.empresas?.inscricao_municipal && (
                          <span className="font-mono text-[10px] bg-secondary px-1.5 py-0.5 rounded border border-border text-foreground/80">
                            IM: {item.empresas?.inscricao_municipal}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-muted-foreground">
                      {item.empresas?.cnpj}
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-semibold text-xs px-2.5 py-1 rounded bg-secondary text-foreground border border-border">
                        {item.lotes?.portal}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs text-muted-foreground whitespace-nowrap">
                      {formatarData(item.created_at)}
                    </td>
                    <td className="px-6 py-4">
                      {getStatusBadge(item.status, item.resultado)}
                      {item.mensagem_erro && (
                        <p className={`text-xs mt-1.5 max-w-xs leading-relaxed ${
                          isItemNegativa(item)
                            ? 'text-emerald-400/80'
                            : item.status === 'alerta' || isItemPositiva(item)
                            ? 'text-amber-400/90'
                            : 'text-red-400'
                        }`}>
                          {item.mensagem_erro}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {item.pdf_url ? (
                        <a 
                          href={item.pdf_url} 
                          target="_blank" 
                          rel="noreferrer" 
                          className="inline-flex items-center gap-1.5 bg-primary/10 hover:bg-primary/20 text-primary px-3 py-1.5 rounded-lg font-medium transition-colors text-xs border border-primary/20 shadow-xs"
                        >
                          <Download size={13}/> Baixar PDF
                        </a>
                      ) : (item.status === "processando" || item.status === "pendente") ? (
                        <div className="flex items-center justify-end gap-2.5">
                          <span className={`text-xs flex items-center gap-1 font-medium ${
                            item.status === "processando" ? "text-blue-400 animate-pulse" : "text-yellow-500/80"
                          }`}>
                            <Clock size={12} className={item.status === "processando" ? "animate-spin" : ""} />
                            {item.status === "processando" ? "Emitindo..." : "Na fila"}
                          </span>
                          <button
                            onClick={() => handleCancelItem(item.id)}
                            disabled={cancelingId === item.id}
                            title="Cancelar esta emissão"
                            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 font-bold transition-all shadow-xs cursor-pointer disabled:opacity-50"
                          >
                            <XCircle size={13} />
                            <span>{cancelingId === item.id ? "Parando..." : "CANCELAR"}</span>
                          </button>
                        </div>
                      ) : item.status === "cancelado" ? (
                        <span className="text-zinc-500 text-xs italic">Cancelada</span>
                      ) : item.status === "alerta" ? (
                        <span className="text-amber-400/70 text-xs italic">Atenção cadastral</span>
                      ) : item.status === "erro" ? (
                        <span className="text-red-400/60 text-xs italic">Não emitido</span>
                      ) : (
                        <span className="text-muted-foreground/40 text-xs">-</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
