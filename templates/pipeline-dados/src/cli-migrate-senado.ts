/**
 * Uso: npm run migrate:senado -- <dir-do-release-legado> [saida.json]
 * O diretório deve conter o datapackage.json legado e o release.json.
 * Sem [saida.json], imprime o descriptor migrado no stdout.
 * Valida o resultado antes de escrever — migração inválida não sai do processo.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { migrarSenado, type DatapackageLegado, type ReleaseLegado } from "./migrate-senado.js";
import { validarDescriptor } from "./validate.js";

const dir = process.argv[2];
if (!dir) {
  console.error("Uso: npm run migrate:senado -- <dir-do-release-legado> [saida.json]");
  process.exit(2);
}

const legado = JSON.parse(readFileSync(join(dir, "datapackage.json"), "utf8")) as DatapackageLegado;
const release = JSON.parse(readFileSync(join(dir, "release.json"), "utf8")) as ReleaseLegado;

const descriptor = migrarSenado(legado, release);
const resultado = validarDescriptor(descriptor);
if (!resultado.ok) {
  console.error("Descriptor migrado NÃO validou — nada foi escrito:");
  for (const erro of resultado.erros) console.error(`  - ${erro}`);
  process.exit(1);
}

const json = JSON.stringify(descriptor, null, 2) + "\n";
const saida = process.argv[3];
if (saida) {
  writeFileSync(saida, json);
  console.log(`Descriptor v2 válido escrito em ${saida}`);
} else {
  process.stdout.write(json);
}
