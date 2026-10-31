import { CidadeConfig } from "./cidades";
import { processarEquiplano } from "./adapter_equiplano";
import { processarIPM } from "./adapter_ipm";
import { processarEL } from "./adapter_el";
import { processarBetha } from "./adapter_betha";
import { processarEPublica } from "./adapter_epublica";
import { processarElotech } from "./adapter_elotech";
import { processarMegaSoft } from "./adapter_megasoft";
import { processarSaoPaulo } from "./adapter_sp";
import { processarOsasco } from "./adapter_osasco";
import { processarSBC } from "./adapter_sbc";
import { processarSantanaParnaiba } from "./adapter_santana";
import { processarAruja } from "./adapter_aruja";
import { processarCorumba } from "./adapter_corumba";
import { processarD2TI } from "./adapter_d2ti";

export async function processarMunicipal(
  empresa: { nome: string; cnpj: string; inscricao_municipal?: string },
  cidadeConfig: CidadeConfig,
  credenciais: string = "",
  perfilCert?: string
): Promise<{ status: string; resultado: string; pdf_url?: string; mensagem_erro?: string }> {
  console.log(`[DISPATCHER MUNICIPAL] Executando motor: ${cidadeConfig.engine} para ${cidadeConfig.nomeOficial} (${cidadeConfig.uf})`);

  switch (cidadeConfig.engine) {
    case "EQUIPLANO":
      // Capanema, Planalto, Realeza
      return await processarEquiplano(empresa, cidadeConfig);

    case "IPM":
      // Cascavel, Pato Bragado, Entre Rios do Oeste
      return await processarIPM(empresa, cidadeConfig);

    case "EL_PRODUCOES":
      // Vila Velha, São Mateus, Linhares
      return await processarEL(empresa, cidadeConfig);

    case "BETHA":
      // Capitão Leônidas Marques
      return await processarBetha(empresa, cidadeConfig);

    case "E_PUBLICA":
      // Pérola D'Oeste
      return await processarEPublica(empresa);

    case "ELOTECH":
      // Rosana
      return await processarElotech(empresa, cidadeConfig);

    case "MEGASOFT":
      // Paranhos
      return await processarMegaSoft(empresa);

    case "SAO_PAULO_DUC":
      // São Paulo (Capital)
      return await processarSaoPaulo(empresa);

    case "SIGT_OSASCO":
      // Osasco
      return await processarOsasco(empresa);

    case "SBC":
      // São Bernardo do Campo
      return await processarSBC(empresa);

    case "SANTANA_PARNAIBA":
      // Santana de Parnaíba
      return await processarSantanaParnaiba(empresa);

    case "ARUJA_LOGIN":
      // Arujá (Requer login com senha descriptografada ou Certificado Digital)
      return await processarAruja(empresa, credenciais, perfilCert);

    case "CORUMBA_JSF":
      // Corumbá
      return await processarCorumba(empresa);

    case "D2TI_STM":
      // Imperatriz/MA
      return await processarD2TI(empresa, cidadeConfig);

    default:
      console.warn(`[DISPATCHER MUNICIPAL] Motor ${cidadeConfig.engine} não reconhecido.`);
      return {
        status: "erro",
        resultado: "EM CONSTRUÇÃO",
        mensagem_erro: `Motor ${cidadeConfig.engine} (${cidadeConfig.nomeOficial}) não reconhecido.`
      };
  }
}
