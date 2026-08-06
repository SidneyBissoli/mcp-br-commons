/**
 * Uso: npm run validate -- <caminho/para/datapackage.json>
 * Sai com código 1 se o descriptor for inválido.
 */
import { validarArquivo } from "./validate.js";

const caminho = process.argv[2];
if (!caminho) {
  console.error("Uso: npm run validate -- <caminho/para/datapackage.json>");
  process.exit(2);
}

const resultado = validarArquivo(caminho);
if (resultado.ok) {
  console.log(`OK — ${caminho} é um Data Package v2 válido (profile + checagens do portfólio).`);
} else {
  console.error(`INVÁLIDO — ${caminho}:`);
  for (const erro of resultado.erros) console.error(`  - ${erro}`);
  process.exit(1);
}
