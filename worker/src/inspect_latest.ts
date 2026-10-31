import { supabase } from "./supabase";

async function inspectLatestBatch() {
  const { data: lotes } = await supabase
    .from("lotes")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(3);

  console.log("=== ULTIMOS LOTES CRIADOS ===");
  console.log(JSON.stringify(lotes, null, 2));

  if (!lotes || lotes.length === 0) return;

  const ultimoLote = lotes[0];
  console.log("\n=======================================================");
  console.log(`ANALISANDO LOTE ID: ${ultimoLote.id} | Portal: ${ultimoLote.portal} | Criado em: ${ultimoLote.created_at}`);
  console.log("=======================================================");

  const { data: itens } = await supabase
    .from("lote_itens")
    .select("*, empresas(*)")
    .eq("lote_id", ultimoLote.id)
    .order("created_at", { ascending: true });

  const total = itens?.length || 0;
  const sucesso = itens?.filter(i => i.status === "sucesso").length || 0;
  const alerta = itens?.filter(i => i.status === "alerta").length || 0;
  const erro = itens?.filter(i => i.status === "erro").length || 0;

  console.log(`TOTAL DE ITENS: ${total} | SUCESSOS: ${sucesso} | ALERTAS: ${alerta} | ERROS: ${erro}\n`);

  for (const item of (itens || [])) {
    if (item.status === "erro") {
      console.log(">>> [ERRO]");
      console.log(`Empresa: ${item.empresas?.nome} (CNPJ: ${item.empresas?.cnpj})`);
      console.log(`Município: ${item.empresas?.municipio} | IM: ${item.empresas?.inscricao_municipal}`);
      console.log(`Resultado: ${item.resultado}`);
      console.log(`Mensagem de Erro: ${item.mensagem_erro}\n`);
    } else {
      console.log(`[OK] ${item.empresas?.nome} (${item.empresas?.municipio}) -> ${item.resultado}`);
    }
  }
}

inspectLatestBatch().catch(console.error);
