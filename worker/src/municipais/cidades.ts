export type EngineMunicipal = 
  | "IPM" 
  | "EQUIPLANO" 
  | "EL_PRODUCOES" 
  | "BETHA" 
  | "E_PUBLICA" 
  | "ELOTECH" 
  | "MEGASOFT" 
  | "SAO_PAULO_DUC" 
  | "SIGT_OSASCO" 
  | "SBC" 
  | "SANTANA_PARNAIBA" 
  | "ARUJA_LOGIN" 
  | "CORUMBA_JSF"
  | "D2TI_STM";

export interface CidadeConfig {
  nomeOficial: string;
  uf: "PR" | "SP" | "ES" | "MS" | "MA";
  engine: EngineMunicipal;
  url: string;
  exigeInscricaoMunicipal: boolean;
  exigeLogin: boolean;
  observacoes?: string;
}

// Dicionário com os 19 portais mapeados
export const CIDADES_MAP: Record<string, CidadeConfig> = {
  // PARANÁ (PR)
  "CASCAVEL": {
    nomeOficial: "Cascavel",
    uf: "PR",
    engine: "IPM",
    url: "https://cascavel.atende.net/autoatendimento/servicos/certidao-negativa-de-debitos",
    exigeInscricaoMunicipal: false,
    exigeLogin: false
  },
  "PATO BRAGADO": {
    nomeOficial: "Pato Bragado",
    uf: "PR",
    engine: "IPM",
    url: "https://patobragado.atende.net/autoatendimento/servicos/certidao-negativa-de-debitos",
    exigeInscricaoMunicipal: false,
    exigeLogin: false
  },
  "ENTRE RIOS DO OESTE": {
    nomeOficial: "Entre Rios do Oeste",
    uf: "PR",
    engine: "IPM",
    url: "https://entreriosdooeste.atende.net/autoatendimento/servicos/certidao-negativa-de-debitos",
    exigeInscricaoMunicipal: false,
    exigeLogin: false
  },
  "ENTRE RIOS": {
    nomeOficial: "Entre Rios do Oeste",
    uf: "PR",
    engine: "IPM",
    url: "https://entreriosdooeste.atende.net/autoatendimento/servicos/certidao-negativa-de-debitos",
    exigeInscricaoMunicipal: false,
    exigeLogin: false
  },
  "CAPANEMA": {
    nomeOficial: "Capanema",
    uf: "PR",
    engine: "EQUIPLANO",
    url: "https://capanema.pr.gov.br",
    exigeInscricaoMunicipal: false,
    exigeLogin: false
  },
  "PLANALTO": {
    nomeOficial: "Planalto",
    uf: "PR",
    engine: "EQUIPLANO",
    url: "https://planalto.pr.gov.br",
    exigeInscricaoMunicipal: false,
    exigeLogin: false
  },
  "REALEZA": {
    nomeOficial: "Realeza",
    uf: "PR",
    engine: "EQUIPLANO",
    url: "https://realeza.pr.gov.br",
    exigeInscricaoMunicipal: false,
    exigeLogin: false
  },
  "CAPITAO LEONIDAS MARQUES": {
    nomeOficial: "Capitão Leônidas Marques",
    uf: "PR",
    engine: "BETHA",
    url: "https://e-gov.betha.com.br/cdweb/03114-545/contribuinte/rel_certidaonegativa.faces",
    exigeInscricaoMunicipal: false,
    exigeLogin: false
  },
  "PEROLA D OESTE": {
    nomeOficial: "Pérola D'Oeste",
    uf: "PR",
    engine: "E_PUBLICA",
    url: "http://cidadao-peroladooeste.e-publica.net/peroladooeste_sefaz/jsp/cnd/index.jsp",
    exigeInscricaoMunicipal: false,
    exigeLogin: false
  },

  // ESPÍRITO SANTO (ES)
  "VILA VELHA": {
    nomeOficial: "Vila Velha",
    uf: "ES",
    engine: "EL_PRODUCOES",
    url: "https://tributacao.vilavelha.es.gov.br/tbw/loginWeb.jsp?execobj=ServicosWebSite&tab=tabCertNegCont",
    exigeInscricaoMunicipal: false,
    exigeLogin: false
  },
  "SAO MATEUS": {
    nomeOficial: "São Mateus",
    uf: "ES",
    engine: "EL_PRODUCOES",
    url: "https://servicos.cloud.el.com.br/es-saomateus-pm/services/certidao_retirada.php",
    exigeInscricaoMunicipal: false,
    exigeLogin: false
  },
  "LINHARES": {
    nomeOficial: "Linhares",
    uf: "ES",
    engine: "EL_PRODUCOES",
    url: "https://ws.linhares.es.gov.br/services/certidao_retirada.php",
    exigeInscricaoMunicipal: false,
    exigeLogin: false
  },

  // SÃO PAULO (SP)
  "SAO PAULO": {
    nomeOficial: "São Paulo",
    uf: "SP",
    engine: "SAO_PAULO_DUC",
    url: "https://duc.prefeitura.sp.gov.br/certidoes/forms_anonimo/frmConsultaEmissaoCertidao.aspx",
    exigeInscricaoMunicipal: false,
    exigeLogin: false
  },
  "ROSANA": {
    nomeOficial: "Rosana",
    uf: "SP",
    engine: "ELOTECH",
    url: "https://www.rosana.sp.gov.br",
    exigeInscricaoMunicipal: false,
    exigeLogin: false
  },
  "SAO BERNARDO DO CAMPO": {
    nomeOficial: "São Bernardo do Campo",
    uf: "SP",
    engine: "SBC",
    url: "https://www.saobernardo.sp.gov.br",
    exigeInscricaoMunicipal: true,
    exigeLogin: false
  },
  "OSASCO": {
    nomeOficial: "Osasco",
    uf: "SP",
    engine: "SIGT_OSASCO",
    url: "https://sigt.osasco.sp.gov.br/iTRIB2/ArrSolicitarCnd_Internet.do",
    exigeInscricaoMunicipal: true,
    exigeLogin: false
  },
  "SANTANA DE PARNAIBA": {
    nomeOficial: "Santana de Parnaíba",
    uf: "SP",
    engine: "SANTANA_PARNAIBA",
    url: "https://santanadeparnaiba.sp.gov.br",
    exigeInscricaoMunicipal: true,
    exigeLogin: false
  },
  "SANTANA DA PARAIBA": {
    nomeOficial: "Santana de Parnaíba",
    uf: "SP",
    engine: "SANTANA_PARNAIBA",
    url: "https://santanadeparnaiba.sp.gov.br",
    exigeInscricaoMunicipal: true,
    exigeLogin: false
  },
  "ARUJA": {
    nomeOficial: "Arujá",
    uf: "SP",
    engine: "ARUJA_LOGIN",
    url: "https://servicos.prefeituradearuja.sp.gov.br/tbw/loginCNPJContribuinte.jsp?execobj=ContribuintesWebRelacionados",
    exigeInscricaoMunicipal: false,
    exigeLogin: true,
    observacoes: "Exige login e senha ou Gov.br no portal municipal devido a restrições de LGPD"
  },

  // MATO GROSSO DO SUL (MS)
  "CORUMBA": {
    nomeOficial: "Corumbá",
    uf: "MS",
    engine: "CORUMBA_JSF",
    url: "http://nfse.corumba.ms.gov.br:8080/servicosweb/home.jsf",
    exigeInscricaoMunicipal: true,
    exigeLogin: false
  },
  "PARANHOS": {
    nomeOficial: "Paranhos",
    uf: "MS",
    engine: "MEGASOFT",
    url: "https://paranhos.megasoftservicos.com.br/cidadao/emissao-certidao-negat",
    exigeInscricaoMunicipal: false,
    exigeLogin: false
  },

  // MARANHÃO (MA)
  "IMPERATRIZ": {
    nomeOficial: "Imperatriz",
    uf: "MA",
    engine: "D2TI_STM",
    url: "https://stm.imperatriz.d2ti.com.br/credenciamento/jsp/emissaoCertidao/emissaoPublicaCertidao.jsf",
    exigeInscricaoMunicipal: false,
    exigeLogin: false
  }
};

export function normalizarNomeCidade(cidade: string): string {
  if (!cidade) return "";
  return cidade
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove acentos
    .replace(/[-_']/g, " ")          // Remove hífens e apóstrofos
    .replace(/\s+/g, " ")            // Espaços múltiplos
    .trim()
    .toUpperCase();
}

export function obterConfiguracaoCidade(cidadeRaw: string): CidadeConfig | null {
  const normalizada = normalizarNomeCidade(cidadeRaw);
  
  // Tenta encontrar correspondência exata
  if (CIDADES_MAP[normalizada]) {
    return CIDADES_MAP[normalizada];
  }

  // Tenta correspondência sem a sigla do estado (ex: "CASCAVEL PR" -> "CASCAVEL")
  const semUf = normalizada.replace(/\s+(PR|SP|ES|MS|MA|SC|RJ|MG|RS|MT|GO|DF)$/, "").trim();
  if (CIDADES_MAP[semUf]) {
    return CIDADES_MAP[semUf];
  }

  // Busca parcial
  for (const chave in CIDADES_MAP) {
    if (normalizada.includes(chave) || chave.includes(normalizada)) {
      return CIDADES_MAP[chave];
    }
  }

  return null;
}
