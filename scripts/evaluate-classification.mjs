import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { referenceCases, datasetVersion } from "../evals/reference-cases.mjs";
import { classificationSchema, taxonomy, CONTRACT_VERSION } from "../lib/classification-contract.mjs";
import { evaluate } from "../lib/classification-evaluation.mjs";

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--predictions", "--split", "--output"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Uso: npm run eval:classification -- [--predictions arquivo.json] [--split dev|test|all] [--output relatorio.json]");
    if (options[args[i]]) throw new Error(`Argumento duplicado: ${args[i]}`);
    options[args[i]] = args[i + 1];
  }
  const split = options["--split"] ?? "test";
  if (!["dev", "test", "all"].includes(split)) throw new Error("Split inválido");
  const cases = referenceCases.filter((c) => split === "all" || c.split === split);
  const hash = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
  const metadata = { dataset_version: datasetVersion, dataset_sha256: hash(referenceCases), contract_version: CONTRACT_VERSION, contract_sha256: hash(classificationSchema), taxonomy_version: taxonomy.version, taxonomy_sha256: hash(taxonomy), split };
  let report = { ...metadata, status: "pending_model_run_and_domain_review", cases: cases.length, human_reviewed_cases: 0, metrics: null, message: "Estrutura pronta; nenhuma inferência executada. Não há medida de acurácia do modelo." };
  if (options["--predictions"]) {
    const input = JSON.parse(await readFile(options["--predictions"], "utf8"));
    for (const key of ["dataset_version", "dataset_sha256", "contract_version", "contract_sha256", "taxonomy_version", "taxonomy_sha256", "split"]) {
      if (input.run?.[key] !== metadata[key]) throw new Error(`Metadado incompatível: ${key}`);
    }
    for (const key of ["model", "prompt_version", "dictionary_version", "executed_at"]) if (typeof input.run?.[key] !== "string" || !input.run[key].trim()) throw new Error(`Metadado obrigatório: ${key}`);
    if (Number.isNaN(Date.parse(input.run.executed_at))) throw new Error("executed_at inválido");
    if (!Array.isArray(input.entities)) throw new Error("Informe entities: [] se não houve dicionário; caso contrário, o snapshot consultado.");
    if (input.run.dictionary_version === "none" && input.entities.length) throw new Error("dictionary_version none exige snapshot vazio");
    const entityIds = new Set();
    for (const entity of input.entities) {
      if (!entity || typeof entity.id !== "string" || !entity.id.trim() || !Object.hasOwn(taxonomy.entities, entity.entity_type) || !["homologated", "candidate", "rejected", "consolidated"].includes(entity.governance_status) || entityIds.has(entity.id)) throw new Error("Snapshot de entidades inválido ou com IDs duplicados");
      entityIds.add(entity.id);
    }
    const result = evaluate(cases, input.predictions, { entities: input.entities });
    report = { ...metadata, status: "evaluated_pending_domain_review", run: input.run, predictions_sha256: hash(input.predictions), dictionary_sha256: hash(input.entities), ...result };
  }
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options["--output"]) await writeFile(options["--output"], json, "utf8");
  process.stdout.write(json);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
