import { processarBetha } from "./municipais/adapter_betha";
import { processarOsasco } from "./municipais/adapter_osasco";
import { processarAruja } from "./municipais/adapter_aruja";
import { CIDADES_MAP } from "./municipais/cidades";

async function verifyAllThree() {
  console.log("=== 1. TESTANDO CAPITÃO LEÔNIDAS MARQUES (BETHA) ===");
  const resBetha = await processarBetha(
    { nome: "R D M MONTAGEM INDUSTRIAL LTDA", cnpj: "54.051.223/0001-07" },
    CIDADES_MAP["CAPITAO LEONIDAS MARQUES"]
  );
  console.log("Resultado Betha:", resBetha);

  console.log("\n=== 2. TESTANDO OSASCO (SIGT) ===");
  const resOsasco = await processarOsasco({
    nome: "SNOOP DOG PET SHOP LTDA",
    cnpj: "34.978.116/0001-11",
    inscricao_municipal: "141546"
  });
  console.log("Resultado Osasco:", resOsasco);

  console.log("\n=== 3. TESTANDO ARUJÁ ===");
  const resAruja = await processarAruja(
    { nome: "VILELA GAS MULTIMARCAS LTDA", cnpj: "60.246.250/0001-38" },
    ""
  );
  console.log("Resultado Arujá:", resAruja);
}

verifyAllThree().catch(console.error);
