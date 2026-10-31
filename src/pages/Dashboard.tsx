import { UploadCloud, Play, FileSpreadsheet, X, CheckCircle2, Loader2, Lock, XCircle, ShieldCheck } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import { isValidCNPJ, formatCNPJ } from "../lib/cnpj";
import { supabase } from "../lib/supabase";
import { encryptText } from "../lib/crypto";
import { ClearActions } from "../components/ClearActions";
import { getPanelClearedAt, PANEL_UPDATED_EVENT } from "../lib/clearPanel";

interface CompanyData {
  name: string;
  cnpj: string;
  municipio?: string;
  inscricaoMunicipal?: string;
  login?: string;
  certProfile?: "INTEGRADOS" | "PARCEIRO";
  valid: boolean;
}

export function Dashboard() {
  const [selectedPath, setSelectedPath] = useState("FEDERAL");
  const [selectedCert, setSelectedCert] = useState<"INTEGRADOS" | "PARCEIRO">("INTEGRADOS");
  const [companies, setCompanies] = useState<CompanyData[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Estados para as métricas do BD
  const [metrics, setMetrics] = useState({
    lotesHoje: 0,
    certidoesEmitidas: 0,
    positivas: 0,
    erros: 0,
    processando: 0,
  });

  // Carrega os números reais do Supabase (respeitando se o usuário limpou a visualização do painel)
  const loadMetrics = async () => {
    try {
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const clearedAt = getPanelClearedAt();
      const baseLotesTime = clearedAt && new Date(clearedAt) > hoje ? clearedAt : hoje.toISOString();

      let qLotes = supabase
        .from("lotes")
        .select("*", { count: "exact", head: true })
        .gte("created_at", baseLotesTime);

      let qEmitidas = supabase
        .from("lote_itens")
        .select("*", { count: "exact", head: true })
        .eq("status", "sucesso");

      let qPositivas = supabase
        .from("lote_itens")
        .select("*", { count: "exact", head: true })
        .eq("status", "sucesso")
        .in("resultado", ["POSITIVA", "POSITIVA_EFEITO_NEGATIVA", "POSITIVA COM EFEITO DE NEGATIVA", "IRREGULAR"]);

      let qAlertas = supabase
        .from("lote_itens")
        .select("*", { count: "exact", head: true })
        .eq("status", "alerta");

      let qErros = supabase
        .from("lote_itens")
        .select("*", { count: "exact", head: true })
        .eq("status", "erro");

      const qProcessando = supabase
        .from("lote_itens")
        .select("*", { count: "exact", head: true })
        .in("status", ["pendente", "processando"]);

      if (clearedAt) {
        qEmitidas = qEmitidas.gt("created_at", clearedAt);
        qPositivas = qPositivas.gt("created_at", clearedAt);
        qAlertas = qAlertas.gt("created_at", clearedAt);
        qErros = qErros.gt("created_at", clearedAt);
      }

      const [
        { count: countLotes },
        { count: countEmitidas },
        { count: countPositivas },
        { count: countAlertas },
        { count: countErros },
        { count: countProcessando }
      ] = await Promise.all([
        qLotes,
        qEmitidas,
        qPositivas,
        qAlertas,
        qErros,
        qProcessando
      ]);

      setMetrics({
        lotesHoje: countLotes || 0,
        certidoesEmitidas: countEmitidas || 0,
        positivas: (countPositivas || 0) + (countAlertas || 0),
        erros: countErros || 0,
        processando: countProcessando || 0,
      });
    } catch (e) {
      console.error("Erro ao carregar métricas:", e);
    }
  };

  const handleCancelEmissoes = async () => {
    try {
      setIsCanceling(true);
      const { error } = await supabase
        .from('lote_itens')
        .update({
          status: 'cancelado',
          resultado: 'CANCELADO',
          mensagem_erro: 'Cancelado pelo usuário.'
        })
        .in('status', ['pendente', 'processando']);

      if (error) throw error;
      setToastMessage("Emissões canceladas com sucesso!");
      setTimeout(() => setToastMessage(""), 4000);
      await loadMetrics();
    } catch (err) {
      console.error("Erro ao cancelar emissões:", err);
    } finally {
      setIsCanceling(false);
    }
  };

  useEffect(() => {
    loadMetrics();
    const interval = setInterval(loadMetrics, 3000);
    const handlePanelUpdated = () => {
      loadMetrics();
    };
    window.addEventListener(PANEL_UPDATED_EVENT, handlePanelUpdated);
    return () => {
      clearInterval(interval);
      window.removeEventListener(PANEL_UPDATED_EVENT, handlePanelUpdated);
    };
  }, []);

  const paths = [
    { id: "FEDERAL", name: "Federal", desc: "Receita e PGFN" },
    { id: "ESTADUAL", name: "Estadual", desc: "SEFAZ / Receita Estadual (PR, SP, ES, MS, MA)" },
    { id: "TRABALHISTA", name: "Trabalhista", desc: "TST" },
    { id: "CAIXA", name: "FGTS (Caixa)", desc: "CRF Regularidade" },
    { id: "MUNICIPAL", name: "Municipal", desc: "Automático por Cidade" },
  ];

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);

    // Auto-detecta o certificado pelo nome da planilha se houver indicação
    const lowerFileName = file.name.toLowerCase();
    if (
      lowerFileName.includes("parceir") ||
      lowerFileName.includes("agricola") ||
      lowerFileName.includes("agrícola") ||
      lowerFileName.includes("175983") ||
      lowerFileName.includes("i s") ||
      lowerFileName.includes("is_")
    ) {
      setSelectedCert("PARCEIRO");
    } else if (
      lowerFileName.includes("integrad") ||
      lowerFileName.includes("344493") ||
      lowerFileName.includes("principal")
    ) {
      setSelectedCert("INTEGRADOS");
    }

    const reader = new FileReader();

    reader.onload = (event) => {
      const data = new Uint8Array(event.target?.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      const json: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      const parsedCompanies: CompanyData[] = [];
      
      if (json.length === 0) return;

      // Análise dos cabeçalhos na primeira linha
      const headers = (json[0] || []).map((h: any) => String(h || "").toLowerCase().trim());
      
      let colName = headers.findIndex(h => h.includes("nome") || h.includes("empresa") || h.includes("raz"));
      let colCnpj = headers.findIndex(h => h.includes("cnpj"));
      let colMun = headers.findIndex(h => h.includes("munic") || h.includes("cidade"));
      let colIm = headers.findIndex(h => h.includes("inscri") || h.includes("im") || h.includes("mobili"));
      let colLogin = headers.findIndex(h => h.includes("login") || h.includes("acesso") || h.includes("usu") || h.includes("user"));
      let colPass = headers.findIndex(h => h.includes("senh") || h.includes("pass"));
      let colCert = headers.findIndex(h => h.includes("certific") || h.includes("escrit") || h.includes("procura"));

      const hasNamedHeaders = colCnpj !== -1;

      for (let i = 1; i < json.length; i++) {
        const row = json[i];
        if (!row || row.length === 0) continue;
        
        let name = "";
        let rawCnpj = "";
        let municipio = "";
        let inscricaoMunicipal = "";
        let login = "";
        let certProfile: "INTEGRADOS" | "PARCEIRO" | undefined = undefined;

        if (hasNamedHeaders) {
          name = String(row[colName !== -1 ? colName : 0] || "").trim();
          rawCnpj = String(row[colCnpj] || "").trim();
          if (colMun !== -1) municipio = String(row[colMun] || "").trim();
          if (colIm !== -1) inscricaoMunicipal = String(row[colIm] || "").trim();
          if (colLogin !== -1) login = String(row[colLogin] || "").trim();
          if (colPass !== -1 && row[colPass]) {
            login = login ? `${login}:${String(row[colPass]).trim()}` : String(row[colPass]).trim();
          }
          if (colCert !== -1 && row[colCert]) {
            const rawCert = String(row[colCert]).toUpperCase();
            if (rawCert.includes("PARCEIR") || rawCert.includes("AGRICOLA") || rawCert.includes("175983") || rawCert === "2") {
              certProfile = "PARCEIRO";
            } else if (rawCert.includes("INTEGRAD") || rawCert.includes("344493") || rawCert === "1") {
              certProfile = "INTEGRADOS";
            }
          }
        } else {
          // Heurística posicional (Nome | CNPJ | Município | Inscrição Municipal | Login)
          const val1 = String(row[0] || "").trim();
          const val2 = String(row[1] || "").trim();
          
          if (val1.replace(/\D/g, "").length > val2.replace(/\D/g, "").length) {
            rawCnpj = val1;
            name = val2;
          } else {
            name = val1;
            rawCnpj = val2;
          }

          if (row.length > 2) municipio = String(row[2] || "").trim();
          if (row.length > 3) inscricaoMunicipal = String(row[3] || "").trim();
          if (row.length > 4) login = String(row[4] || "").trim();
        }

        if (name || rawCnpj) {
          const cleanCnpj = rawCnpj.replace(/[^\d]/g, "");
          parsedCompanies.push({
            name: name || "Empresa sem nome",
            cnpj: formatCNPJ(cleanCnpj),
            municipio: municipio || undefined,
            inscricaoMunicipal: inscricaoMunicipal || undefined,
            login: login || undefined,
            certProfile,
            valid: isValidCNPJ(cleanCnpj)
          });
        }
      }

      setCompanies(parsedCompanies);
    };

    reader.readAsArrayBuffer(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = () => {
    setFileName(null);
    setCompanies([]);
  };

  const handleStartAutomation = async () => {
    const validCompanies = companies.filter(c => c.valid);
    if (validCompanies.length === 0) return;

    setIsSubmitting(true);

    try {
      // Criptografa as credenciais de login no navegador antes de enviar ao Supabase
      const upsertData = await Promise.all(
        validCompanies.map(async (c) => ({
          nome: c.name,
          cnpj: c.cnpj,
          municipio: c.municipio || null,
          inscricao_municipal: c.inscricaoMunicipal || null,
          login_encrypted: c.login ? await encryptText(c.login) : null,
        }))
      );
      
      const { data: insertedCompanies, error: empError } = await supabase
        .from('empresas')
        .upsert(upsertData, { onConflict: 'cnpj' })
        .select('id, cnpj');

      if (empError) throw empError;
      if (!insertedCompanies) throw new Error("Erro ao retornar empresas salvas");

      const { data: lote, error: loteError } = await supabase
        .from('lotes')
        .insert({ portal: selectedPath, status: 'pendente' })
        .select('id')
        .single();

      if (loteError) throw loteError;

      // Mapeia o certificado de cada empresa (ou usa o certificado selecionado no painel)
      const certMap = new Map<string, string>();
      for (const c of validCompanies) {
        certMap.set(c.cnpj, c.certProfile || selectedCert);
      }

      const itensData = insertedCompanies.map(emp => ({
        lote_id: lote.id,
        empresa_id: emp.id,
        status: 'pendente',
        resultado: `CERT:${certMap.get(emp.cnpj) || selectedCert}`
      }));

      const { error: itensError } = await supabase
        .from('lote_itens')
        .insert(itensData);

      if (itensError) throw itensError;

      setToastMessage(`Lote criado com ${itensData.length} empresas na fila. O robô já começou!`);
      setTimeout(() => setToastMessage(""), 5000);
      
      removeFile();
      loadMetrics();
    } catch (error) {
      console.error(error);
      setToastMessage("Erro ao salvar no banco. Verifique se o script SQL foi executado.");
      setTimeout(() => setToastMessage(""), 5000);
    } finally {
      setIsSubmitting(false);
    }
  };

  const validCount = companies.filter(c => c.valid).length;
  const invalidCount = companies.length - validCount;

  return (
    <div translate="no" className="space-y-6 animate-in fade-in duration-500 relative">
      
      {toastMessage && (
        <div className="fixed bottom-8 right-8 bg-green-600 text-white px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom-8 fade-in z-50">
          <CheckCircle2 size={20} />
          <span className="font-medium text-sm">{toastMessage}</span>
        </div>
      )}

      {/* Barra de Topo com Ações de Limpeza */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Painel de Controle</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Acompanhe as emissões e inicie novos lotes automatizados.
          </p>
        </div>

        <ClearActions
          onSuccess={(msg) => {
            removeFile();
            loadMetrics();
            setToastMessage(msg);
            setTimeout(() => setToastMessage(""), 4500);
          }}
        />
      </div>
      
      {/* Métricas Reais do Banco de Dados */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: "Lotes Hoje", value: metrics.lotesHoje, color: "text-white" },
          { label: "Certidões Emitidas", value: metrics.certidoesEmitidas, color: "text-primary" },
          { label: "Positivas / Alertas", value: metrics.positivas, color: "text-amber-400" },
          { label: "Falhas de Sistema", value: metrics.erros, color: "text-red-500" },
        ].map((metric) => (
          <div key={metric.label} className="bg-card border border-border p-5 rounded-xl">
            <h3 className="text-muted-foreground text-sm font-medium">{metric.label}</h3>
            <p className={`text-3xl font-bold mt-2 ${metric.color}`}>{metric.value}</p>
          </div>
        ))}
      </div>

      {/* Banner de Emissão Ativa no Dashboard */}
      {metrics.processando > 0 && (
        <div className="bg-blue-950/40 border border-blue-500/40 rounded-xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm animate-in fade-in duration-300">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3.5 w-3.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-blue-500"></span>
            </span>
            <div>
              <p className="text-sm font-bold text-foreground">
                {metrics.processando} {metrics.processando === 1 ? 'certidão está sendo gerada agora' : 'certidões estão na fila / sendo geradas'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                O robô está em execução no momento. Você pode cancelar o lote inteiro ou itens específicos no Acervo.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              onClick={handleCancelEmissoes}
              disabled={isCanceling}
              className="w-full sm:w-auto bg-red-600/90 hover:bg-red-600 text-white text-xs font-bold px-4 py-2.5 rounded-lg transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
            >
              <XCircle size={15} />
              <span>{isCanceling ? "Cancelando..." : "CANCELAR EMISSÃO"}</span>
            </button>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <div className="p-6 border-b border-border">
          <h2 className="text-xl font-bold">Nova Emissão em Lote</h2>
          <p className="text-muted-foreground text-sm mt-1">Configure os parâmetros e inicie o robô.</p>
        </div>
        
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
          
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center text-primary">
              <span className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center mr-2 text-sm">1</span> 
              Selecionar Empresas
            </h3>
            
            <input 
              type="file" 
              accept=".xlsx, .xls, .csv" 
              className="hidden" 
              ref={fileInputRef}
              onChange={handleFileUpload}
            />

            {!fileName ? (
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-border hover:border-primary/50 transition-colors rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer bg-secondary/30"
              >
                <UploadCloud className="w-10 h-10 text-muted-foreground mb-3" />
                <p className="font-medium">Clique para escolher a planilha</p>
                <p className="text-xs text-muted-foreground mt-1">.xlsx ou .csv (Nome e CNPJ)</p>
              </div>
            ) : (
              <div className="border border-primary/30 bg-primary/5 rounded-xl p-6 flex flex-col items-center justify-center text-center relative">
                <button 
                  onClick={removeFile}
                  className="absolute top-3 right-3 text-muted-foreground hover:text-red-400 transition-colors"
                >
                  <X size={18} />
                </button>
                <FileSpreadsheet className="w-10 h-10 text-primary mb-2" />
                <p className="font-medium text-foreground">{fileName}</p>
                <div className="flex gap-4 mt-3 text-sm">
                  <span className="text-green-500 flex items-center gap-1 font-bold">
                    ✓ {validCount} {validCount === 1 ? "Válido" : "Válidos"}
                  </span>
                  {invalidCount > 0 && (
                    <span className="text-red-400 flex items-center gap-1 font-bold">
                      ⚠ {invalidCount} {invalidCount === 1 ? "Inválido" : "Inválidos"}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="pt-2 space-y-2.5">
              <h3 className="font-semibold flex items-center text-primary text-sm">
                <ShieldCheck size={16} className="mr-1.5" />
                Certificado Digital (Procuração da Planilha)
              </h3>
              <div className="grid grid-cols-1 gap-2.5">
                <button
                  type="button"
                  onClick={() => setSelectedCert("INTEGRADOS")}
                  className={`text-left p-3 rounded-lg border transition-all flex items-center justify-between ${
                    selectedCert === "INTEGRADOS"
                      ? "border-primary bg-primary/10 ring-1 ring-primary"
                      : "border-border bg-background hover:border-muted-foreground"
                  }`}
                >
                  <div>
                    <p className="font-semibold text-xs text-foreground">
                      Escritório Principal — Soluções Profissionais Integrados
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      CNPJ: 34.449.301/0001-19 • Válido até 29/03/2027
                    </p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    selectedCert === "INTEGRADOS" ? "bg-primary text-white" : "bg-secondary text-muted-foreground"
                  }`}>
                    {selectedCert === "INTEGRADOS" ? "Selecionado" : "Usar"}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedCert("PARCEIRO")}
                  className={`text-left p-3 rounded-lg border transition-all flex items-center justify-between ${
                    selectedCert === "PARCEIRO"
                      ? "border-primary bg-primary/10 ring-1 ring-primary"
                      : "border-border bg-background hover:border-muted-foreground"
                  }`}
                >
                  <div>
                    <p className="font-semibold text-xs text-foreground">
                      Escritório Parceiro — I S Soluções Agrícolas
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      CNPJ: 17.598.373/0001-09 • Válido até 15/03/2027
                    </p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    selectedCert === "PARCEIRO" ? "bg-primary text-white" : "bg-secondary text-muted-foreground"
                  }`}>
                    {selectedCert === "PARCEIRO" ? "Selecionado" : "Usar"}
                  </span>
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="font-semibold flex items-center text-primary">
              <span className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center mr-2 text-sm">2</span> 
              Caminho de Emissão
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {paths.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPath(p.id)}
                  className={`text-left p-3 rounded-lg border transition-all ${
                    selectedPath === p.id 
                    ? "border-primary bg-primary/10 ring-1 ring-primary" 
                    : "border-border bg-background hover:border-muted-foreground"
                  }`}
                >
                  <p className="font-medium text-sm text-foreground">{p.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">{p.desc}</p>
                </button>
              ))}
            </div>

            {selectedPath === "MUNICIPAL" && (
              <div className="mt-4 p-3 bg-secondary/30 border border-border rounded-lg text-xs text-muted-foreground flex items-center gap-2.5 animate-in slide-in-from-top-2">
                <span className="text-base">📍</span>
                <span>O sistema roteia e acessa o portal da prefeitura de cada empresa automaticamente através da coluna <strong>Município</strong> da sua planilha.</span>
              </div>
            )}
          </div>
        </div>

        {companies.length > 0 && (
          <div className="border-t border-border p-6 bg-secondary/10">
            <h3 className="font-medium mb-3 text-sm text-muted-foreground">Prévia da Planilha ({companies.length} registros)</h3>
            <div className="max-h-48 overflow-y-auto border border-border rounded-lg">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground bg-secondary/30 uppercase sticky top-0 border-b border-border">
                  <tr>
                    <th className="px-4 py-2">Empresa</th>
                    <th className="px-4 py-2">CNPJ</th>
                    {companies.some(c => c.municipio) && <th className="px-4 py-2">Município</th>}
                    {companies.some(c => c.inscricaoMunicipal) && <th className="px-4 py-2">Insc. Municipal</th>}
                    {companies.some(c => c.login) && <th className="px-4 py-2">Acesso</th>}
                    <th className="px-4 py-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {companies.map((c, idx) => (
                    <tr key={idx} className="hover:bg-secondary/20">
                      <td className="px-4 py-2 font-medium">{c.name}</td>
                      <td className="px-4 py-2 text-muted-foreground">{c.cnpj}</td>
                      {companies.some(comp => comp.municipio) && (
                        <td className="px-4 py-2 text-muted-foreground">{c.municipio || "-"}</td>
                      )}
                      {companies.some(comp => comp.inscricaoMunicipal) && (
                        <td className="px-4 py-2 text-muted-foreground">{c.inscricaoMunicipal || "-"}</td>
                      )}
                      {companies.some(comp => comp.login) && (
                        <td className="px-4 py-2">
                          {c.login ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-md">
                              <Lock size={10} /> Criptografado
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-2 text-right">
                        {c.valid ? (
                          <span className="text-green-500 font-medium text-xs">Válido</span>
                        ) : (
                          <span className="text-red-400 font-medium text-xs">Inválido</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="bg-secondary/50 p-6 flex justify-end items-center border-t border-border">
          <button 
            disabled={validCount === 0 || isSubmitting}
            onClick={handleStartAutomation}
            className="bg-accent hover:bg-accent-hover text-white px-8 py-3 rounded-lg font-bold flex items-center space-x-2 transition-transform active:scale-95 shadow-lg shadow-accent/20 disabled:opacity-50 disabled:active:scale-100 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <Loader2 className="animate-spin" size={18} />
            ) : (
              <Play fill="currentColor" size={18} />
            )}
            <span>{isSubmitting ? "Enviando..." : "Iniciar Automação"}</span>
          </button>
        </div>
      </div>

    </div>
  );
}
