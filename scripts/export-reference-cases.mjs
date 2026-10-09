import { referenceCases, datasetVersion } from "../evals/reference-cases.mjs";

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify({ dataset_version: datasetVersion, cases: referenceCases }, null, 2)}\n`);
} else {
  const rows = ["# Entrega A — caderno de revisão dos gabaritos", "", `Versão: ${datasetVersion}. Gerado por scripts/export-reference-cases.mjs.`, "", "Todos os casos são sintéticos, com rótulos propostos pelo assistente. Nenhum foi homologado por especialista. Os 20 casos dev podem orientar prompts; os 20 test são reservados à regressão e não devem ser usados como exemplos no prompt. Esta base pública não substitui um teste independente com relatos reais.", "", "Para cada caso, o revisor deve aceitar ou corrigir os valores, registrar justificativa, nome e data. Divergências devem ser resolvidas antes de marcar review_status como approved na fonte. Campo omitido do gabarito não é avaliado; null exige abstenção. Os resultados em produção continuam dependentes de confirmação humana."];
  for (const c of referenceCases) {
    rows.push("", `## ${c.id} — ${c.split} — ${c.tags.join(", ")}`, "", ...c.messages.map(m => `- **${m.role === "user" ? "Usuário" : "Assistente"}:** ${m.text}`), "", "**Gabarito proposto:**", "", ...Object.entries(c.expected.fields).map(([k, v]) => `- ${k}: ${v.map(x => x === null ? "ausente/abstenção (null)" : x).join(" ou ")}`), `- Percepção única: ${c.expected.single_issue ? "sim" : "não"}. Pronto para revisão: ${c.expected.ready_for_validation ? "sim" : "não"}.`, "", `**Justificativa:** ${c.rationale}`, "", "**Revisão humana:** pendente. Responsável/data: —. Decisão/correção: —.");
  }
  process.stdout.write(`${rows.join("\n")}\n`);
}
