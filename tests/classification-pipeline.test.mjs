import test from "node:test";
import assert from "node:assert/strict";
import { createHandler, parseConversation, classify } from "../supabase/functions/_shared/classification-pipeline.mjs";
import { selectContext, resolveEntities, loadDictionary, semanticCandidates, approvedExamples } from "../supabase/functions/_shared/knowledge-context.mjs";
import { invokeGemini, providerBody, geminiSchema, embedQuery, timed } from "../supabase/functions/_shared/classification-provider.mjs";
import { taxonomy, FIELDS, CONTRACT_VERSION, validateClassification } from "../lib/classification-contract.mjs";
import { exampleCatalog } from "../supabase/functions/_shared/examples.generated.mjs";
import { decideReview, DEFAULT_POLICY, analysisEvent, loadReviewPolicy } from '../supabase/functions/_shared/selective-review.mjs';

const messages = [{ role: "user", text: "O sistema de garantias fecha ao salvar." }];
const entities = [
  { id: "gran", entity_type: "sistema", canonical_name: "GRAN", governance_status: "homologated" },
  { id: "mira", entity_type: "sistema", canonical_name: "MIRA", governance_status: "candidate" },
  { id: "sap", entity_type: "sistema", canonical_name: "SAP", governance_status: "homologated" },
];
const aliases = [{ entity_id: "gran", entity_type: "sistema", alias: "sistema de garantias" }];
const snapshot = { entities, aliases, complete: true };
const catalog = { version: "test.1", examples: [] };
function output() {
  const fields = Object.fromEntries(FIELDS.map(name => [name, { value: null, entity_id: null, evidence: "none", sources: [], resolution: "absent", pending_reason: null, confidence: null }]));
  for (const [name, value] of [["tipo", "reclamacao"], ["categoria_problema", "erro"], ["sistema", "sistema de garantias"]]) {
    fields[name] = { value, entity_id: null, evidence: "observed", sources: [{ message_index: 0, quote: messages[0].text }], resolution: name === "sistema" ? "unresolved" : "known", pending_reason: name === "sistema" ? "Aguardando resolução." : null, confidence: 0.8 };
  }
  return { contract_version: CONTRACT_VERSION, taxonomy_version: taxonomy.version, single_issue: true, assistant_message: "Confira o resumo.", ready_for_validation: true, summary: messages[0].text, clarification_question: null, confirmation_required: true, fields };
}
const response = (value = output(), status = 200) => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }] }), { status });
function setup(overrides = {}) {
  const rows = [];
  const dependencies = {
    model: "test-model", catalog, semanticSearch: async () => [],
    repository: { loadDictionary: async () => structuredClone(snapshot), createSession: async row => { rows.push(row); return "analysis-id"; } },
    provider: input => invokeGemini({ ...input, apiKey: "test-key", model: "test-model", fetchImpl: async () => response(), sleep: async () => {} }),
    ...overrides,
  };
  return { rows, dependencies, handler: createHandler(() => dependencies) };
}
const request = (body = { messages }) => new Request("http://localhost/analyze", { method: "POST", body: JSON.stringify(body) });

test('F: alias inequívoco permite confirmação simples, independentemente da confiança, sem autorregistro',async()=>{
  const {dependencies,rows}=setup();const result=await classify(messages,dependencies);
  assert.equal(result.review_policy.action,'simple_confirmation');
  assert.equal(result.review_policy.automatic_recording_allowed,false);
  assert.equal(result.review_policy.human_confirmation_required,true);
  assert.deepEqual(rows[0].raw_response.review_policy,result.review_policy);
  const changed=structuredClone(result);for(const f of Object.values(changed.fields)) if(f.value)f.confidence=0.01;
  assert.deepEqual(decideReview(changed,changed.knowledge),result.review_policy);
});

test('F: novidade, inferência, conhecimento incompleto e suspensão exigem revisão detalhada',async()=>{
  const result=await classify(messages,setup().dependencies);
  for(const mutation of [r=>{r.fields.sistema.resolution='new';r.fields.sistema.entity_id=null;},r=>{r.fields.tipo.evidence='inferred';},r=>{r.knowledge.complete=false;}]){
    const copy=structuredClone(result);mutation(copy);assert.equal(decideReview(copy,copy.knowledge).action,'detailed_review');
  }
  const suspended=decideReview(result,result.knowledge,{...DEFAULT_POLICY,revision:2,simplified_review_enabled:false});
  assert.equal(suspended.action,'detailed_review');assert.equal(suspended.simple_candidate,true);assert.ok(suspended.reasons.includes('simplification_suspended'));
  result.ready_for_validation=false;result.single_issue=false;
  assert.equal(decideReview(result,result.knowledge).action,'clarify');
});

test('F: política remota inválida falha fechada e avaliação offline não grava telemetria',async()=>{
  for(const value of [null,{...DEFAULT_POLICY,version:'unknown'},{...DEFAULT_POLICY,revision:0},{...DEFAULT_POLICY,simplified_review_enabled:'true'}]){
    await assert.rejects(loadReviewPolicy({rpc:()=>({abortSignal:async()=>({data:value})})}),/review_policy_unavailable/);
  }
  const s=setup();s.dependencies.repository.loadReviewPolicy=async()=>{throw new Error('review_policy_unavailable');};
  assert.equal((await (await s.handler(request())).json()).error.code,'review_policy_unavailable');assert.equal(s.rows.length,0);
  const e=setup();e.dependencies.repository.recordAnalysisEvent=async()=>{throw new Error('must_not_call');};
  const result=await classify(messages,{...e.dependencies,persistSession:false});assert.equal(result.analysis_id,null);assert.equal(e.rows.length,0);
});

test('F: HTTP acompanha sucesso e falha sem copiar conteúdo ou erro bruto',async()=>{
  const s=setup();const events=[];s.dependencies.repository.recordAnalysisEvent=async e=>events.push(e);
  assert.equal((await s.handler(request())).status,200);assert.equal(events.length,1);assert.equal(events[0].analysis_session_id,'analysis-id');
  assert.equal(events[0].action,'simple_confirmation');assert.equal(events[0].user_turns,1);assert.equal(JSON.stringify(events).includes(messages[0].text),false);
  s.dependencies.provider=async()=>{throw new Error('secret-provider-body');};
  assert.equal((await s.handler(request())).status,502);assert.equal(events[1].status,'failed');assert.equal(events[1].error_code,'upstream_failure');
  assert.equal(JSON.stringify(events).includes('secret-provider-body'),false);
  const event=analysisEvent({error:new Error('request_timeout'),model:'fixture',messages,elapsedMs:10});assert.equal(event.error_code,'request_timeout');
});

test('F: falha no acompanhamento não devolve proposta como sucesso',async()=>{
  const s=setup();s.dependencies.repository.recordAnalysisEvent=async()=>{throw new Error('analysis_monitoring_unavailable');};
  const response=await s.handler(request());assert.equal(response.status,502);assert.equal((await response.json()).error.code,'analysis_monitoring_unavailable');
  assert.equal(s.rows.length,1,'Sessão órfã expira e nunca é confirmada automaticamente');
});

test('E: pipeline consulta catálogo publicado e retirada afeta a próxima análise',async()=>{
  const s=setup();let active={version:'curated.1',examples:[{id:'curated-fixture',status:'approved',text:messages[0].text,reviewed_by:'Fixture',reviewed_at:'2026-10-09',taxonomy_version:taxonomy.version,classification:Object.fromEntries(FIELDS.map(f=>[f,output().fields[f].value]))}]};
  s.dependencies.repository.loadCatalog=async()=>structuredClone(active);
  const first=await classify(messages,s.dependencies);assert.deepEqual(first.knowledge.example_ids,['curated-fixture']);assert.equal(first.knowledge.examples_version,'curated.1');
  active={version:'curated.2',examples:[]};const second=await classify(messages,s.dependencies);
  assert.deepEqual(second.knowledge.example_ids,[]);assert.notEqual(first.knowledge.examples_sha256,second.knowledge.examples_sha256);
});

test("B: caminho HTTP completo resolve alias, devolve draft compatível e grava somente sessão de revisão", async () => {
  const { rows, handler } = setup(); const result = await handler(request()); const body = await result.json();
  assert.equal(result.status, 200); assert.equal(body.contract_version, "classification.1");
  assert.equal(body.fields.sistema.entity_id, "gran"); assert.equal(body.draft.sistema.value, "sistema de garantias");
  assert.equal(body.analysis_id, "analysis-id"); assert.equal(rows.length, 1);
  assert.equal(rows[0].proposed_interpretation.fields.sistema.entity_id, "gran");
  assert.equal(rows[0].raw_response.conversation[0].text, messages[0].text);
  assert.equal(rows[0].raw_response.context.entities[0].id, "gran");
  assert.match(body.knowledge.dictionary_sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(body).includes("provider_response"), false);
});
test("B: entrada inválida, GET e OPTIONS não consultam provedor nem banco", async () => {
  const handler = createHandler(() => { throw new Error("must_not_call"); });
  assert.equal((await handler(request({ messages: [] }))).status, 400);
  assert.equal((await handler(new Request("http://localhost"))).status, 405);
  assert.equal((await handler(new Request("http://localhost", { method: "OPTIONS" }))).status, 204);
  assert.equal((await handler(new Request("http://localhost", { method: "POST", body: "bad-json" }))).status, 400);
});
test("B: parsing rejeita alternância quebrada e inclui separadores no limite persistido", () => {
  assert.equal(parseConversation([{ role: "user", text: "a" }, { role: "user", text: "b" }]), null);
  assert.equal(parseConversation([{ role: "user", text: "a".repeat(1000) }, { role: "assistant", text: "Qual?" }, { role: "user", text: "b".repeat(1000) }]), null);
  assert.ok(parseConversation(messages));
});
test("B: contexto exclui candidatos, rejeitados, aliases órfãos e exemplos não aprovados", () => {
  const c = selectContext([{ role: "user", text: "MIRA e sistema de garantias" }], { ...snapshot, aliases: [...aliases, { entity_id: "missing", alias: "MIRA" }] }, { ...catalog, examples: [{ status: "pending", text: "MIRA" }] });
  assert.deepEqual(c.entities.map(e => e.id), ["gran"]); assert.equal(c.aliases.length, 1); assert.equal(c.examples.length, 0);
});
test("B: exemplo aprovado só entra com revisão, taxonomia e classificação completas", () => {
  const e = { id: "example", status: "approved", text: messages[0].text, reviewed_by: "reviewer-fixture", reviewed_at: "2026-10-08", taxonomy_version: taxonomy.version, classification: Object.fromEntries(FIELDS.map(f => [f, output().fields[f].value])) };
  assert.equal(selectContext(messages, snapshot, { ...catalog, examples: [e] }).examples.length, 1);
  assert.throws(() => approvedExamples({ ...catalog, examples: [{ ...e, reviewed_by: "" }] }));
  assert.throws(() => approvedExamples({ ...catalog, examples: [{ ...e, taxonomy_version: "old" }] }));
  assert.equal(approvedExamples(exampleCatalog).length, 0, "Não fabricar homologação dos casos sintéticos da entrega A");
});
test("B: resultado semântico é referência e nunca resolve termo parecido automaticamente", () => {
  const c = selectContext(messages, snapshot, catalog, ["sap", "mira"]);
  assert.equal(c.entities.find(e => e.id === "sap").retrieval, "semantic_candidate");
  assert.equal(c.entities.some(e => e.id === "mira"), false);
  const d = output(); d.fields.sistema.value = "SAP semelhante";
  const r = resolveEntities(d, snapshot).output.fields.sistema;
  assert.equal(r.entity_id, null); assert.equal(r.resolution, "new");
});
test("B: colisão entre nome e alias bloqueia revisão e não cria sessão", async () => {
  const { rows, handler } = setup({ repository: { loadDictionary: async () => ({ ...snapshot, aliases: [...aliases, { entity_id: "sap", entity_type: "sistema", alias: "sistema de garantias" }] }), createSession: async row => { rows.push(row); } } });
  const body = await (await handler(request())).json();
  assert.equal(body.ready_for_validation, false); assert.equal(body.fields.sistema.resolution, "ambiguous");
  assert.equal(body.analysis_id, null); assert.equal(rows.length, 0); assert.ok(body.clarification_question);
});
test("B: termo não homologado não é resolvido nem recriado; dicionário parcial impede decisão definitiva", () => {
  const d = output(); d.fields.sistema.value = "MIRA";
  assert.equal(resolveEntities(d, snapshot).output.fields.sistema.resolution, "unresolved");
  const partial = resolveEntities(output(), { ...snapshot, complete: false }).output.fields.sistema;
  assert.equal(partial.entity_id, null); assert.equal(partial.resolution, "unresolved");
});
test("B: conhecimento indisponível interrompe classificação; semântica indisponível degrada explicitamente", async () => {
  let calls = 0;
  const down = setup({ repository: { loadDictionary: async () => { throw new Error("knowledge_unavailable"); } }, provider: async () => { calls++; } });
  assert.equal((await down.handler(request())).status, 502); assert.equal(calls, 0);
  const fallback = setup({ semanticSearch: async () => { throw new Error("offline"); } });
  const body = await (await fallback.handler(request())).json();
  assert.ok(body.knowledge.warnings.includes("semantic_retrieval_unavailable")); assert.equal(body.fields.sistema.entity_id, "gran");
});
test("B: pergunta por múltiplos problemas não persiste sessão", async () => {
  const d = output(); d.single_issue = false; d.ready_for_validation = false; d.summary = null; d.clarification_question = "Qual problema deseja registrar?";
  const { handler, rows } = setup({ provider: async () => ({ output: d, rawResponse: {}, attempts: 1 }) });
  const body = await (await handler(request())).json(); assert.equal(body.analysis_id, null); assert.equal(rows.length, 0);
});
test("B: contrato do provedor inválido é rejeitado sem sessão, mesmo com rótulos plausíveis", async () => {
  const d = output(); d.fields.sistema.sources[0].quote = "Trecho inventado";
  const { handler, rows } = setup({ provider: async () => ({ output: d }) });
  const result = await handler(request()); assert.equal(result.status, 502); assert.equal(rows.length, 0);
});
test("B: chamada Gemini separa instruções, usa schema e nunca envia secrets em URL", async () => {
  const context = selectContext(messages, snapshot, catalog); const body = providerBody(messages, context);
  assert.ok(body.systemInstruction.parts[0].text.includes("5W2H"));
  assert.ok(body.contents[0].parts[0].text.includes("institutional_context"));
  assert.equal(geminiSchema().properties.summary.nullable, true);
  assert.equal(geminiSchema().properties.confirmation_required.type, "boolean");
  const result = await invokeGemini({ messages, context, model: "test", apiKey: "secret-fixture", fetchImpl: async (url, opts) => {
    assert.equal(url.includes("secret-fixture"), false); assert.equal(opts.headers["x-goog-api-key"], "secret-fixture"); assert.ok(opts.signal); return response();
  } });
  assert.equal(result.attempts, 1);
});
test("B: Gemini repete 429/5xx e corrige contrato, mas não repete 400", async () => {
  let calls = 0;
  const input = { messages, context: {}, model: "test", apiKey: "test", sleep: async () => {} };
  const result = await invokeGemini({ ...input, fetchImpl: async () => ++calls === 1 ? response(null, 429) : response() });
  assert.equal(result.attempts, 2);
  calls = 0;
  await assert.rejects(invokeGemini({ ...input, fetchImpl: async () => { calls++; return response(null, 400); } }), /provider_rejected_request/);
  assert.equal(calls, 1);
  calls = 0;
  const repaired = await invokeGemini({ ...input, fetchImpl: async (_url, opts) => {
    calls++;
    if (calls === 1) return response({});
    assert.ok(JSON.parse(JSON.parse(opts.body).contents[0].parts[0].text).prior_validation_errors.length); return response();
  } });
  assert.equal(repaired.attempts, 2);
});
test("B: saída truncada, ID inventado e resposta inválida esgotam tentativas sem aceitação", async () => {
  const input = { messages, context: {}, model: "test", apiKey: "test", sleep: async () => {} };
  let calls = 0;
  const d = output(); d.fields.sistema.entity_id = "gran"; d.fields.sistema.resolution = "known";
  await assert.rejects(invokeGemini({ ...input, fetchImpl: async () => { calls++; return response(d); } }), /invalid_provider_response/);
  assert.equal(calls, 2);
  await assert.rejects(invokeGemini({ ...input, fetchImpl: async () => new Response(JSON.stringify({ candidates: [{ finishReason: "MAX_TOKENS" }] })) }), /invalid_provider_response/);
});
test("B: tempo limite cancela requisição e não fica esperando provedor indefinidamente", async () => {
  let aborted = false;
  await assert.rejects(timed(signal => new Promise(() => { signal.addEventListener("abort", () => { aborted = true; }); }), 10), /request_timeout/);
  assert.equal(aborted, true);
});
test("B: embeddings conferem dimensão, modelo e configuração", async () => {
  const input = { apiKey: "fixture", model: "gemini-embedding-001", fetchImpl: async (_url, opts) => {
    const body = JSON.parse(opts.body); assert.equal(body.embedContentConfig.outputDimensionality, 768);
    return new Response(JSON.stringify({ embedding: { values: Array(768).fill(0.1) } }));
  } };
  assert.equal((await embedQuery("consulta", input)).length, 768);
  await assert.rejects(embedQuery("consulta", { ...input, fetchImpl: async () => new Response('{"embedding":{"values":[1]}}') }), /invalid_embedding/);
});

function fakeClient(tables, rpcRows = []) {
  const calls = [];
  return { calls, rpc: (name, args) => ({ abortSignal: async () => { calls.push({ name, args }); return { data: rpcRows }; } }), from(table) {
    let rows = tables[table] ?? []; let start = 0; let end = Infinity;
    const q = {
      select: () => q, order: () => q,
      range: (a, b) => { start = a; end = b; return q; },
      in: (key, values) => { rows = rows.filter(r => values.includes(r[key])); return q; },
      eq: (key, value) => { rows = rows.filter(r => r[key] === value); return q; },
      limit: count => { end = count - 1; return q; },
      abortSignal: async () => { calls.push({ table, start, end }); return { data: rows.slice(start, end + 1) }; },
    }; return q;
  } };
}
test("B: repositório pagina além de 500 linhas e marca limite conservadoramente", async () => {
  const client = fakeClient({ entities: Array.from({ length: 501 }, (_, i) => ({ id: String(i) })), entity_aliases: [] });
  const loaded = await loadDictionary(client); assert.equal(loaded.entities.length, 501); assert.equal(loaded.complete, true);
  const capped = await loadDictionary(fakeClient({ entities: Array(2000).fill(entities[0]) }));
  assert.equal(capped.complete, false);
});
test("B: recuperação semântica exclui embeddings gerados por outro modelo", async () => {
  const client = fakeClient({ perception_embeddings: [{ perception_id: "p1", embedding_model: "current" }, { perception_id: "p2", embedding_model: "old" }], entity_evidence: [{ perception_id: "p1", entity_id: "gran" }, { perception_id: "p2", entity_id: "sap" }] }, [{ perception_id: "p1" }, { perception_id: "p2" }]);
  assert.deepEqual(await semanticCandidates(client, Array(768).fill(0.1), "current"), ["gran"]);
});
