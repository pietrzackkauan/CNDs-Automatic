import { obterConfiguracaoCidade } from "../municipais/cidades";
import { processarEstadualPR } from "./adapter_pr";
import { processarEstadualSP } from "./adapter_sp";
import { processarEstadualES } from "./adapter_es";
import { processarEstadualMS } from "./adapter_ms";
import { processarEstadualMA } from "./adapter_ma";

export type EstadoUF = "PR" | "SP" | "ES" | "MS" | "MA";

export function inferirUF(municipio?: string | null): EstadoUF {
  if (!municipio) return "PR"; // Default do escritório (PR)

  // 1. Tenta identificar pela base de cidades mapeadas
  const config = obterConfiguracaoCidade(municipio);
  if (config && config.uf) {
    return config.uf;
  }

  // 2. Tenta regex por sigla explícita (ex: "Arujá - SP", "Capanema/PR", "Vila Velha ES")
  const upper = municipio.toUpperCase();
  if (/\bSP\b/.test(upper) || upper.includes("SÃO PAULO") || upper.includes("SAO PAULO")) return "SP";
  if (/\bES\b/.test(upper) || upper.includes("ESPÍRITO SANTO") || upper.includes("ESPIRITO SANTO")) return "ES";
  if (/\bMS\b/.test(upper) || upper.includes("MATO GROSSO DO SUL")) return "MS";
  if (/\bMA\b/.test(upper) || upper.includes("MARANHÃO") || upper.includes("MARANHAO")) return "MA";
  if (/\bPR\b/.test(upper) || upper.includes("PARANÁ") || upper.includes("PARANA")) return "PR";

  return "PR";
}

export async function processarEstadual(
  empresa: {
    cnpj: string;
    nome: string;
    municipio?: string | null;
  },
  perfilCert?: string
): Promise<{
  status: string;
  resultado: string;
  pdf_url?: string;
  mensagem_erro?: string;
}> {
  const uf = inferirUF(empresa.municipio);
  console.log(`- [ESTADUAL] Direcionando empresa "${empresa.nome}" para SEFAZ do Estado: ${uf}`);

  switch (uf) {
    case "PR":
      return await processarEstadualPR(empresa.cnpj);
    case "SP":
      return await processarEstadualSP(empresa.cnpj, perfilCert);
    case "ES":
      return await processarEstadualES(empresa.cnpj);
    case "MS":
      return await processarEstadualMS(empresa.cnpj);
    case "MA":
      return await processarEstadualMA(empresa.cnpj);
    default:
      return {
        status: "erro",
        resultado: "UF NÃO RECONHECIDA",
        mensagem_erro: `Estado ${uf} não possui robô estadual configurado.`
      };
  }
}
