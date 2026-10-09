import { FIELDS, validateClassification } from "./classification-contract.mjs";

const normalized = (value) => typeof value === "string" ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ") : value;
const metric = () => ({ correct: 0, total: 0, rate: null });
const finish = (m) => ({ ...m, rate: m.total ? m.correct / m.total : null });

export function evaluate(cases, predictions, context = {}) {
  if (!Array.isArray(predictions)) throw new Error("predictions deve ser uma lista");
  const ids = new Set(cases.map((c) => c.id));
  const byId = new Map();
  for (const prediction of predictions) {
    if (!prediction || !ids.has(prediction.case_id)) throw new Error(`Caso desconhecido: ${prediction?.case_id}`);
    if (byId.has(prediction.case_id)) throw new Error(`Caso duplicado: ${prediction.case_id}`);
    byId.set(prediction.case_id, prediction);
  }
  const fields = Object.fromEntries(FIELDS.map((name) => [name, metric()]));
  const readiness = metric(); const singleIssue = metric();
  const details = [];
  let valid = 0; let unnecessaryQuestions = 0; let prematureReviews = 0;
  for (const item of cases) {
    const prediction = byId.get(item.id);
    const result = prediction ? validateClassification(prediction.output, { messages: item.messages, entities: context.entities ?? [] }) : { valid: false, errors: ["missing_prediction"] };
    const mismatches = [];
    if (result.valid) valid++;
    for (const [name, accepted] of Object.entries(item.expected.fields)) {
      fields[name].total++;
      if (result.valid && accepted.some((v) => normalized(v) === normalized(prediction.output.fields[name].value))) fields[name].correct++;
      else mismatches.push(name);
    }
    readiness.total++; singleIssue.total++;
    if (result.valid && prediction.output.ready_for_validation === item.expected.ready_for_validation) readiness.correct++;
    if (result.valid && prediction.output.single_issue === item.expected.single_issue) singleIssue.correct++;
    if (result.valid && !prediction.output.ready_for_validation && item.expected.ready_for_validation) unnecessaryQuestions++;
    if (result.valid && prediction.output.ready_for_validation && !item.expected.ready_for_validation) prematureReviews++;
    details.push({ case_id: item.id, valid: result.valid, errors: result.errors, mismatched_fields: mismatches });
  }
  const latencies = predictions.map((p) => p.latency_ms).filter((n) => typeof n === "number" && Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  const costs = predictions.map((p) => p.cost_usd);
  return {
    purpose: "evaluation_against_proposed_labels_not_production_certification",
    total_cases: cases.length, submitted: predictions.length, missing: cases.length - predictions.length,
    contract: { valid, total: cases.length, rate: cases.length ? valid / cases.length : null },
    fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, finish(value)])),
    readiness: finish(readiness), single_issue: finish(singleIssue),
    unnecessary_questions: unnecessaryQuestions, premature_reviews: prematureReviews,
    latency: { samples: latencies.length, mean_ms: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null, p95_ms: latencies.length ? latencies[Math.ceil(latencies.length * 0.95) - 1] : null },
    cost_usd: costs.length === cases.length && costs.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0) ? costs.reduce((a, b) => a + b, 0) : null,
    human_reviewed_cases: cases.filter((c) => c.review_status === "approved").length,
    semantic_fabrication_rate: null,
    limitations: ["Trecho presente não comprova suporte semântico: invenções, negações e pertinência exigem revisão humana.", "Campos sem gabarito não entram no denominador.", "Ausências e contratos inválidos contam como erro, nunca são descartados.", "Latência e custo são informados pelo executor, não estimados pelo avaliador."],
    details,
  };
}
