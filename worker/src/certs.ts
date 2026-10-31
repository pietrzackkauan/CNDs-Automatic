import path from "path";
import fs from "fs";

export type CertProfile = "INTEGRADOS" | "PARCEIRO" | "AUTO";

export interface CertInfo {
  id: "INTEGRADOS" | "PARCEIRO";
  nome: string;
  cnpj: string;
  pfxPath: string;
  passphrase: string;
}

function resolverCaminhoCertificado(relOrAbsPath: string, fallbackFileName: string): string | null {
  const candidates = [
    path.isAbsolute(relOrAbsPath) ? relOrAbsPath : path.resolve(__dirname, "../", relOrAbsPath),
    path.resolve(__dirname, "../../", relOrAbsPath),
    path.resolve(__dirname, "../certs", fallbackFileName),
    path.resolve(__dirname, "../../", fallbackFileName),
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function normalizarPerfilCertificado(raw?: string | null): CertProfile {
  if (!raw) return "AUTO";
  const upper = raw.toUpperCase().replace(/^CERT:/, "").trim();
  if (upper.includes("PARCEIR") || upper.includes("AGRICOLA") || upper.includes("175983") || upper === "2") {
    return "PARCEIRO";
  }
  if (upper.includes("INTEGRAD") || upper.includes("344493") || upper === "1") {
    return "INTEGRADOS";
  }
  return "AUTO";
}

export function obterCertificados(perfilRaw?: string | null): CertInfo[] {
  const perfil = normalizarPerfilCertificado(perfilRaw);

  const fileIntegrados = "SOLUCOES PROFISSIONAIS INTEGRADOS LTDA_29032027_344493.pfx";
  const pathIntegrados = resolverCaminhoCertificado(
    process.env.SP_CERT_PATH || `certs/${fileIntegrados}`,
    fileIntegrados
  );
  const passIntegrados = process.env.SP_CERT_PASS || "344493";

  const fileParceiro = "CNPJ_I S SOLUCOES AGRICOLAS LTDA_15032027_175983.pfx";
  const pathParceiro = resolverCaminhoCertificado(
    process.env.SP_CERT_PARCEIRO_PATH || `certs/${fileParceiro}`,
    fileParceiro
  );
  const passParceiro = process.env.SP_CERT_PARCEIRO_PASS || "175983";

  const certIntegrados: CertInfo | null = pathIntegrados
    ? {
        id: "INTEGRADOS",
        nome: "SOLUÇÕES PROFISSIONAIS INTEGRADOS LTDA",
        cnpj: "34.449.301/0001-19",
        pfxPath: pathIntegrados,
        passphrase: passIntegrados,
      }
    : null;

  const certParceiro: CertInfo | null = pathParceiro
    ? {
        id: "PARCEIRO",
        nome: "I S SOLUÇÕES AGRÍCOLAS LTDA",
        cnpj: "17.598.373/0001-09",
        pfxPath: pathParceiro,
        passphrase: passParceiro,
      }
    : null;

  const lista: CertInfo[] = [];

  if (perfil === "PARCEIRO") {
    if (certParceiro) lista.push(certParceiro);
    if (certIntegrados) lista.push(certIntegrados);
  } else {
    if (certIntegrados) lista.push(certIntegrados);
    if (certParceiro) lista.push(certParceiro);
  }

  return lista;
}

export function obterCertificadoPrincipal(perfilRaw?: string | null): CertInfo | null {
  const lista = obterCertificados(perfilRaw);
  return lista.length > 0 ? lista[0] : null;
}

export function construirClientCertificates(origins: string[], cert: CertInfo) {
  return origins.map((origin) => ({
    origin,
    pfxPath: cert.pfxPath,
    passphrase: cert.passphrase,
  }));
}
