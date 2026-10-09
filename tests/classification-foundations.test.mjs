import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classificationSchema, CONTRACT_VERSION, FIELDS, taxonomy, validateClassification } from "../lib/classification-contract.mjs";
import { evaluate } from "../lib/classification-evaluation.mjs";
import { referenceCases } from "../evals/reference-cases.mjs";

const messages = [{ role: "user", text: "O GRAN fecha ao salvar." }];
const empty = () => ({ value: null, entity_id: null, evidence: "none", sources: [], resolution: "absent", pending_reason: null, confidence: null });
function fixture() {
  const fields = Object.fromEntries(FIELDS.map((f) => [f, empty()]));
  for (const [name, value] of [["tipo", "reclamacao"], ["categoria_problema", "erro"], ["sistema", "GRAN"]]) {
    fields[name] = { value, entity_id: null, evidence: "observed", sources: [{ message_index: 0, quote: messages[0].text }], resolution: name === "sistema" ? "unresolved" : "known", pending_reason: name === "sistema" ? "Dicionário ainda não consultado." : null, confidence: 0.8 };
  }
  return { contract_version: CONTRACT_VERSION, taxonomy_version: taxonomy.version, single_issue: true, assistant_message: "Confira o resumo.", ready_for_validation: true, summary: "O GRAN fecha ao salvar.", clarification_question: null, confirmation_required: true, fields };
}
const valid = (data, context = { messages }) => validateClassification(data, context).valid;

test("contrato permite revisão com entidades não resolvidas e campos opcionais ausentes", () => assert.equal(valid(fixture()), true));
test("rejeita versão, campos ausentes, propriedades extras, enum inválido e valores não finitos", () => {
  for (const change of [d => { d.contract_version = "legacy"; }, d => { delete d.single_issue; }, d => { d.approved = true; }, d => { d.fields.tipo.value = "urgente"; }, d => { d.fields.tipo.confidence = NaN; }, d => { d.fields.sistema.value = " "; }]) {
    const d = fixture(); change(d); assert.equal(valid(d), false);
  }
});
test("citação deve existir em mensagem do usuário, não em fala do assistente", () => {
  const d = fixture(); d.fields.sistema.sources[0].quote = "SAP"; assert.equal(valid(d), false);
  assert.equal(valid(fixture(), { messages: [{ role: "assistant", text: messages[0].text }] }), false);
});
test("valor preenchido exige evidência rastreável", () => {
  const d = fixture(); d.fields.sistema.sources = []; assert.equal(valid(d), false);
});
test("entidade conhecida exige ID homologado e tipo compatível", () => {
  const d = fixture(); d.fields.sistema.resolution = "known"; d.fields.sistema.entity_id = "system-gran";
  for (const entities of [[], [{ id: "system-gran", entity_type: "sistema", governance_status: "candidate" }], [{ id: "system-gran", entity_type: "produto", governance_status: "homologated" }]]) assert.equal(valid(d, { messages, entities }), false);
  assert.equal(valid(d, { messages, entities: [{ id: "system-gran", entity_type: "sistema", governance_status: "homologated" }] }), true);
});
test("múltiplos problemas exigem pergunta e impedem revisão", () => {
  const d = fixture(); d.single_issue = false; assert.equal(valid(d), false);
  d.ready_for_validation = false; d.summary = null; d.clarification_question = "Qual problema deseja registrar primeiro?";
  assert.equal(valid(d), true);
});
test("confiança alta não libera hipótese ou categoria ambígua", () => {
  const d = fixture(); d.fields.categoria_problema = { ...empty(), resolution: "ambiguous", pending_reason: "Erro ou lentidão?", confidence: 1 };
  assert.equal(valid(d), false);
  d.ready_for_validation = false; d.summary = null; d.clarification_question = "A operação termina?"; assert.equal(valid(d), true);
});
test("não aplicável não é sinônimo de categoria outro ou valor preenchido", () => {
  const d = fixture(); d.fields.produto.resolution = "not_applicable"; assert.equal(valid(d), true);
  d.fields.produto.value = "Consórcio"; assert.equal(valid(d), false);
  d.fields.categoria_problema = { ...empty(), resolution: "not_applicable" }; assert.equal(valid(d), false);
});
test("confirmação humana é obrigatória e sugestão não resolvida impede revisão", () => {
  const d = fixture(); d.confirmation_required = false; assert.equal(valid(d), false);
  d.confirmation_required = true; d.fields.sistema.evidence = "suggested"; assert.equal(valid(d), false);
});
test("base proposta tem IDs únicos, splits separados, justificativas e cobertura dos seis campos", () => {
  assert.equal(new Set(referenceCases.map(c => c.id)).size, referenceCases.length);
  assert.equal(referenceCases.length, 40);
  for (const split of ["dev", "test"]) {
    const cases = referenceCases.filter(c => c.split === split);
    assert.equal(cases.length, 20);
    for (const category of Object.keys(taxonomy.categories)) assert.ok(cases.some(c => c.expected.fields.categoria_problema.includes(category)), `Categoria sem cobertura: ${category}`);
    for (const type of Object.keys(taxonomy.types)) assert.ok(cases.some(c => c.expected.fields.tipo.includes(type)), `Tipo sem cobertura: ${type}`);
    for (const field of FIELDS) assert.ok(cases.some(c => Object.hasOwn(c.expected.fields, field)));
    for (const c of cases) {
      assert.equal(c.review_status, "pending_domain_review"); assert.equal(c.provenance, "synthetic"); assert.ok(c.rationale);
      for (const [name, accepted] of Object.entries(c.expected.fields)) {
        assert.ok(FIELDS.includes(name)); assert.ok(Array.isArray(accepted) && accepted.length);
        if (name === "tipo" || name === "categoria_problema") for (const v of accepted) assert.ok(v === null || Object.hasOwn(name === "tipo" ? taxonomy.types : taxonomy.categories, v));
      }
    }
  }
});
const oneCase = { id: "fixture", messages, review_status: "pending_domain_review", expected: { fields: { tipo: ["reclamacao"], categoria_problema: ["erro"], sistema: ["GRAN"], produto: [null] }, single_issue: true, ready_for_validation: true } };
test("avaliador separa contrato de acerto semântico e não ignora respostas ausentes", () => {
  const d = fixture(); d.fields.categoria_problema.value = "lentidao";
  const r = evaluate([oneCase], [{ case_id: "fixture", output: d }]);
  assert.equal(r.contract.rate, 1); assert.equal(r.fields.categoria_problema.rate, 0); assert.equal(r.fields.sistema.rate, 1);
  assert.equal(r.fields.processo.rate, null); assert.equal(r.cost_usd, null); assert.equal(r.semantic_fabrication_rate, null);
  const missing = evaluate([oneCase], []); assert.equal(missing.missing, 1); assert.equal(missing.fields.tipo.rate, 0);
});
test("avaliador penaliza contrato inválido mesmo com rótulos corretos", () => {
  const d = fixture(); d.confirmation_required = false;
  const r = evaluate([oneCase], [{ case_id: "fixture", output: d }]);
  assert.equal(r.contract.rate, 0); assert.equal(r.fields.tipo.rate, 0);
});
test("avaliador rejeita duplicação e casos fora do split", () => {
  assert.throws(() => evaluate([oneCase], [{ case_id: "unknown" }]));
  assert.throws(() => evaluate([oneCase], [{ case_id: "fixture" }, { case_id: "fixture" }]));
});
test("avaliador mede perguntas desnecessárias, revisão precoce e latência informada", () => {
  const d = fixture(); d.ready_for_validation = false; d.summary = null; d.clarification_question = "Qual é o produto?";
  const r = evaluate([oneCase], [{ case_id: "fixture", output: d, latency_ms: 120, cost_usd: 0.01 }]);
  assert.equal(r.unnecessary_questions, 1); assert.equal(r.readiness.rate, 0); assert.equal(r.latency.p95_ms, 120); assert.equal(r.cost_usd, 0.01);
  const early = evaluate([{ ...oneCase, expected: { ...oneCase.expected, ready_for_validation: false } }], [{ case_id: "fixture", output: fixture() }]);
  assert.equal(early.premature_reviews, 1);
});
test("exportação do schema é JSON válido e igual à fonte do validador", () => {
  const result = execFileSync(process.execPath, ["scripts/export-classification-schema.mjs"], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(result), classificationSchema);
});
test("CLI registra execução pendente sem simular acurácia e valida metadados", async () => {
  const result = spawnSync(process.execPath, ["scripts/evaluate-classification.mjs"], { encoding: "utf8" });
  assert.equal(result.status, 0); const pending = JSON.parse(result.stdout);
  assert.equal(pending.metrics, null); assert.equal(pending.cases, 20);
  const directory = await mkdtemp(join(tmpdir(), "classification-eval-"));
  try {
    const path = join(directory, "predictions.json");
    const input = { run: { ...pending, model: "fixture-only", prompt_version: "fixture.1", dictionary_version: "none", executed_at: "2026-10-08T12:00:00Z" }, entities: [], predictions: [] };
    await writeFile(path, JSON.stringify(input));
    let run = spawnSync(process.execPath, ["scripts/evaluate-classification.mjs", "--predictions", path], { encoding: "utf8" });
    assert.equal(run.status, 0); assert.equal(JSON.parse(run.stdout).missing, 20);
    input.run.dataset_sha256 = "wrong"; await writeFile(path, JSON.stringify(input));
    run = spawnSync(process.execPath, ["scripts/evaluate-classification.mjs", "--predictions", path], { encoding: "utf8" });
    assert.notEqual(run.status, 0); assert.match(run.stderr, /dataset_sha256/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
