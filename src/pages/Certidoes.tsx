import { CheckCircle2, XCircle, Clock, Download, Search, Filter, RotateCcw, FileText, AlertTriangle } from "lucide-react";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "../lib/supabase";

// Função para remover acentos e padronizar textos em português
function normalizar(texto: string = ""): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function Certidoes() {
  const [itens, setItens] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [isCancelingAll, setIsCancelingAll] = useState(false);

  // Filtros de busca
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"TODOS" | "NEGATIVA" | "POSITIVA" | "PROCESSANDO" | "ERRO" | "CANCELADO">("TODOS");
  const [portalFilter, setPortalFilter] = useState<string>("TODOS");

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
    return () => clearInterval(interval);
  }, []);

  // Filtragem robusta à prova de falhas (imune a acentos, pontuação de CNPJ e maiúsculas/minúsculas)
  const filteredItens = useMemo(() => {
    const rawSearch = searchTerm.trim();
    const termNorm = normalizar(rawSearch);
    const termDigits = rawSearch.replace(/\D/g, "");

    return itens.filter((item) => {
      // 1. Busca por Nome, CNPJ ou Inscrição Municipal
      if (rawSearch) {
        const nomeNorm = normalizar(item.empresas?.nome || "");
        const cnpjOriginal = String(item.empresas?.cnpj || "");
        const cnpjDigits = cnpjOriginal.replace(/\D/g, "");
        const municipioNorm = normalizar(item.empresas?.municipio || "");
        const imOriginal = String(item.empresas?.inscricao_municipal || "");
        const imDigits = imOriginal.replace(/\D/g, "");

        // Bate se o nome contiver o termo (ignora acentos: "grãos" acha "graos" e vice-versa)
        const matchNome = nomeNorm.includes(termNorm);

        // Bate se o CNPJ contiver os números digitados (ex: "12345" acha "12.345.678/0001-90")
        const matchCnpj = (termDigits.length > 0 && cnpjDigits.includes(termDigits)) || cnpjOriginal.includes(rawSearch);

        // Bate se for pelo município
        const matchMunicipio = municipioNorm.includes(termNorm);

        // Bate se for pela Inscrição Municipal
        const matchIm = (termDigits.length > 0 && imDigits.includes(termDigits)) || (imOriginal && imOriginal.includes(rawSearch));

        if (!matchNome && !matchCnpj && !matchMunicipio && !matchIm) {
          return false;
        }
      }

      // 2. Filtro por Portal (Federal, Estadual, Trabalhista, Caixa, Municipal)
      if (portalFilter !== "TODOS") {
        if (item.lotes?.portal !== portalFilter) return false;
      }

      // 3. Filtro por Status
      if (statusFilter !== "TODOS") {
        if (statusFilter === "NEGATIVA") {
          if (!item.resultado?.includes("NEGATIVA") || item.status !== "sucesso") return false;
        } else if (statusFilter === "POSITIVA") {
          if (!item.resultado?.includes("POSITIVA") && !item.resultado?.includes("PENDÊNCIA") && item.status !== "alerta") return false;
        } else if (statusFilter === "PROCESSANDO") {
          if (item.status !== "processando" && item.status !== "pendente") return false;
        } else if (statusFilter === "ERRO") {
          if (item.status !== "erro" || item.status === "alerta" || item.resultado?.includes("PENDÊNCIA")) return false;
        } else if (statusFilter === "CANCELADO") {
          if (item.status !== "cancelado") return false;
        }
      }

      return true;
    });
  }, [itens, searchTerm, statusFilter, portalFilter]);

  // Contagens para as abas rápidas
  const counts = useMemo(() => {
    return {
      total: itens.length,
      negativas: itens.filter(i => i.status === "sucesso" && i.resultado?.includes("NEGATIVA")).length,
      positivas: itens.filter(i => i.resultado?.includes("POSITIVA") || i.resultado?.includes("PENDÊNCIA") || i.status === "alerta").length,
      processando: itens.filter(i => i.status === "processando" || i.status === "pendente").length,
      erros: itens.filter(i => i.status === "erro" && i.status !== "alerta" && !i.resultado?.includes("PENDÊNCIA")).length,
      canceladas: itens.filter(i => i.status === "cancelado").length,
    };
  }, [itens]);

  const limparFiltros = () => {
    setSearchTerm("");
    setStatusFilter("TODOS");
    setPortalFilter("TODOS");
  };

  const hasFiltrosAtivos = searchTerm !== "" || statusFilter !== "TODOS" || portalFilter !== "TODOS";

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
    
    if (resultado?.includes("NEGATIVA")) {
      return <span className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1.5 w-fit"><CheckCircle2 size={12}/> {resultado}</span>;
    }
    const labelPositiva = (resultado === "REGULAR" || !resultado) ? "POSITIVA" : resultado;
    return <span className="bg-amber-500/10 text-amber-500 border border-amber-500/30 px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1.5 w-fit"><AlertTriangle size={12}/> {labelPositiva}</span>;
  };

  const formatarData = (isoDate: string) => {
    if (!isoDate) return "-";
    const d = new Date(isoDate);
    return `${d.toLocaleDateString("pt-BR")} às ${d.toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="text-primary" size={26} />
            Acervo de Certidões Emitidas
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Localize e baixe qualquer CND emitida no sistema pesquisando pelo Nome da Empresa ou CNPJ.
          </p>
        </div>
      </div>

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
        
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Campo de pesquisa com botão integrado */}
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
            <input 
              type="text" 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Digite o Nome da Empresa ou CNPJ (ex: 12.345.678/0001-90 ou 12345678)..." 
              className="w-full bg-background border border-border rounded-lg pl-10 pr-4 py-2.5 text-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-all placeholder:text-muted-foreground/70"
            />
          </div>

          <div className="flex items-center gap-2">
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
                className="bg-secondary/60 hover:bg-secondary text-muted-foreground hover:text-foreground px-3 py-2.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors border border-border"
              >
                <RotateCcw size={14} />
                <span className="hidden sm:inline">Limpar</span>
              </button>
            )}
          </div>
        </div>

        {/* Pílulas de Status Rápidas */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/50">
          <span className="text-xs font-semibold text-muted-foreground mr-1 uppercase tracking-wider">Situação:</span>

          <button
            onClick={() => setStatusFilter("TODOS")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
              statusFilter === "TODOS"
                ? "bg-foreground text-background border-foreground font-semibold shadow-sm"
                : "bg-background text-muted-foreground border-border hover:bg-secondary/40"
            }`}
          >
            Todas ({counts.total})
          </button>

          <button
            onClick={() => setStatusFilter("NEGATIVA")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
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
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
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
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
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
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
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
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
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
        <div className="px-6 py-3.5 border-b border-border bg-secondary/15 flex justify-between items-center text-xs text-muted-foreground font-medium">
          <span>
            Mostrando <strong className="text-foreground">{filteredItens.length}</strong> de <strong className="text-foreground">{itens.length}</strong> certidões encontradas
          </span>
          {searchTerm && (
            <span className="text-primary font-medium">
              Filtrado por: "{searchTerm}"
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
                        {rawSearchIsActive(searchTerm)
                          ? `Não encontramos nenhuma certidão emitida com o termo "${searchTerm}". Verifique o CNPJ ou nome digitado.`
                          : "Nenhuma certidão cadastrada até o momento. Processe um lote no Dashboard para gerar o acervo."}
                      </p>
                      {hasFiltrosAtivos && (
                        <button
                          onClick={limparFiltros}
                          className="mt-3 text-xs bg-primary text-primary-foreground px-3.5 py-1.5 rounded-lg font-medium hover:opacity-90 transition-opacity inline-flex items-center gap-1.5 shadow-sm"
                        >
                          <RotateCcw size={13} /> Limpar Busca e Filtros
                        </button>
                      )}
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
                        <p className={`text-xs mt-1.5 max-w-xs leading-relaxed ${item.status === 'alerta' ? 'text-amber-400/90' : 'text-red-400'}`}>
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

function rawSearchIsActive(term: string) {
  return term.trim().length > 0;
}
