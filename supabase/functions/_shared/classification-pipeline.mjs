import { taxonomy, CONTRACT_VERSION, validateClassification } from "./classification-contract.mjs";
import { selectContext, resolveEntities } from "./knowledge-context.mjs";
import { timed, PROMPT_VERSION, validateInterpretation } from "./classification-provider.mjs";
import { DEFAULT_POLICY, decideReview, analysisEvent } from './selective-review.mjs';

export function parseConversation(value) {
  if (!Array.isArray(value) || !value.length || value.length > 12) return null;
  if (value.some((m, i) => !m || m.role !== (i % 2 ? "assistant" : "user") || typeof m.text !== "string" || !m.text.trim() || m.text.trim().length > 2000)) return null;
  if (value.at(-1).role !== "user") return null;
  const result = value.map(m => ({ role: m.role, text: m.text.trim() }));
  // Include the separators that will actually be persisted.
  if (result.filter(m => m.role === "user").map(m => m.text).join("\n").length > 2000) return null;
  return result;
}

async function fingerprint(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(v => v.toString(16).padStart(2, "0")).join("");
}

export async function classify(messages, { repository, provider, catalog, model, semanticSearch, signal, persistSession = true }) {
  const policy = repository.loadReviewPolicy ? await timed(s => repository.loadReviewPolicy(s), 5000, signal) : DEFAULT_POLICY;
  const snapshot = await timed(s => repository.loadDictionary(s), 7000, signal);
  if (repository.loadCatalog) catalog = await timed(s => repository.loadCatalog(s), 7000, signal);
  const warnings = snapshot.complete ? [] : ["dictionary_snapshot_limited"];
  let semanticIds = [];
  if (semanticSearch) {
    try { semanticIds = await timed(s => semanticSearch(messages, s), 5000, signal); }
    catch { warnings.push("semantic_retrieval_unavailable"); }
  } else warnings.push("semantic_retrieval_disabled");
  const context = selectContext(messages, snapshot, catalog, semanticIds);
  if (!context.examples.length) warnings.push("no_relevant_approved_examples");
  const inference = await provider({ messages, context, signal });
  // Defense in depth: injected/alternative providers must respect the same contract.
  const initial = validateInterpretation(inference.output, messages);
  if (!initial.valid) throw new Error("invalid_provider_response");
  const { output, decisions } = resolveEntities(inference.output, snapshot);
  const validation = validateClassification(output, { messages, entities: snapshot.entities });
  if (!validation.valid) throw new Error("invalid_resolved_classification");
  const knowledge = {
    dictionary_sha256: await fingerprint(snapshot), examples_version: catalog.version,
    examples_sha256: await fingerprint(catalog), context_sha256: await fingerprint(context),
    entity_ids: context.entities.map(e => e.id), example_ids: context.examples.map(e => e.id),
    complete: snapshot.complete, warnings, decisions,
  };
  // Keep current persistence and browser consumers compatible while carrying full fields.
  const draft = output.fields;
  const review_policy = decideReview(output, knowledge, policy);
  let analysisId = null;
  if (output.ready_for_validation && persistSession) {
    analysisId = await timed(s => repository.createSession({
      original_text: messages.filter(m => m.role === "user").map(m => m.text).join("\n"),
      prompt_version: PROMPT_VERSION, model,
      raw_response: { provider_response: inference.rawResponse, classification: output, conversation: messages, knowledge, context, attempts: inference.attempts, review_policy },
      proposed_interpretation: { interpretation: output.summary, fields: draft, contract_version: CONTRACT_VERSION, taxonomy_version: taxonomy.version, knowledge, review_policy },
    }, s), 7000, signal);
  }
  return { ...output, draft, analysis_id: analysisId, model, prompt_version: PROMPT_VERSION, knowledge, review_policy };
}

export function createHandler(dependencies) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json; charset=utf-8" };
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: corsHeaders });
  return async request => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== "POST") return reply(405, { error: { code: "method_not_allowed", message: "Use POST." } });
    const payload = await request.json().catch(() => null);
    const messages = parseConversation(payload?.messages);
    if (!messages) return reply(400, { error: { code: "invalid_conversation", message: "Envie até 12 mensagens alternadas e 2.000 caracteres do usuário, incluindo separadores." } });
    let deps;
    const started = performance.now();
    let result;
    try {
      deps = dependencies();
      result = await timed(signal => classify(messages, { ...deps, signal }), 45000, request.signal);
      if (deps.repository.recordAnalysisEvent) await timed(signal => deps.repository.recordAnalysisEvent(analysisEvent({ result, model: deps.model, messages, elapsedMs: performance.now() - started }), signal), 3000);
      return reply(200, result);
    } catch (error) {
      // A telemetry failure must not turn an unobserved success into a release.
      // Failures have no raw text, provider response, or credential in this table.
      if (!result && deps?.repository.recordAnalysisEvent) {
        try { await timed(signal => deps.repository.recordAnalysisEvent(analysisEvent({ error, model: deps.model, messages, elapsedMs: performance.now() - started }), signal), 3000); }
        catch { console.error('analysis_monitoring_unavailable'); }
      }
      const code = error instanceof Error ? error.message : "upstream_failure";
      const messagesByCode = {
        knowledge_unavailable: "Não foi possível consultar as referências de classificação. Tente novamente.",
        review_policy_unavailable: "Não foi possível consultar as regras de revisão. Tente novamente.",
        analysis_monitoring_unavailable: "Não foi possível registrar o acompanhamento da análise. Tente novamente.",
        invalid_provider_response: "A IA não retornou uma classificação sustentada pelo relato. Tente novamente.",
        request_timeout: "A análise excedeu o tempo disponível. Tente novamente.",
      };
      const publicCode = Object.hasOwn(messagesByCode, code) ? code : "upstream_failure";
      return reply(502, { error: { code: publicCode, message: messagesByCode[publicCode] ?? "Não foi possível concluir a análise agora." } });
    }
  };
}
