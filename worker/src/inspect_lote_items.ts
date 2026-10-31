import { supabase } from "./supabase";

async function inspectLote() {
  const { data, error } = await supabase
    .from("lote_itens")
    .select("*, empresas(*)")
    .eq("lote_id", "9c228ce8-a599-4bd8-844e-542dbe314ba6");

  if (error) {
    console.error("Error fetching lote items:", error);
    return;
  }

  for (const item of data || []) {
    console.log("----------------------------------------");
    console.log("Empresa:", item.empresas?.nome, "(CNPJ:", item.empresas?.cnpj, ")");
    console.log("Municipio:", item.empresas?.municipio);
    console.log("Status:", item.status, "| Resultado:", item.resultado);
    console.log("Mensagem Erro:", item.mensagem_erro);
    console.log("PDF URL:", item.pdf_url);
  }
}

inspectLote().catch(console.error);
