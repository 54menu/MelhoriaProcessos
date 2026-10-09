import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PROMPT_VERSION = "poc-evolution.0";
const MODEL = Deno.env.get("EVOLUTION_MODEL") || Deno.env.get("GEMINI_MODEL") || "gemini-3.5-flash-lite";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

type EntitySummary = { id: string; entity_type: string; canonical_name: string; governance_status: string; evidence_count: number };

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function isKnownId(value: unknown, valid: Set<string>) {
  return typeof value === "string" && valid.has(value);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return reply(405, { error: { code: "method_not_allowed", message: "Use POST." } });
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return reply(500, { error: { code: "persistence_failed", message: "Evolução indisponível." } });
  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  try {
    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== "object") return reply(400, { error: { code: "invalid_json", message: "Envie um JSON válido." } });
    const operation = (payload as Record<string, unknown>).operation;

    if (operation === "list") {
      const { data, error } = await client.from("knowledge_suggestions").select("id, suggestion_type, proposal, evidence, status, created_at, reviewed_at, review_note").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return reply(200, { suggestions: data ?? [] });
    }

    if (operation === "review") {
      const body = payload as Record<string, unknown>;
      const suggestionId = typeof body.suggestion_id === "string" ? body.suggestion_id : null;
      if (!suggestionId || typeof body.approved !== "boolean") {
        return reply(400, { error: { code: "invalid_review", message: "Decisão inválida. Informe sugestão e aprovação." } });
      }
      const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;
      const { error } = await client.rpc("review_knowledge_suggestion", { p_suggestion_id: suggestionId, p_approved: body.approved, p_note: note });
      if (error) {
        return reply(409, { error: { code: "suggestion_unavailable", message: "A sugestão não pôde ser aplicada ou já foi revisada." } });
      }
      return reply(200, { status: body.approved ? "approved" : "rejected" });
    }

    if (operation !== "generate") return reply(400, { error: { code: "unknown_operation", message: "Operação não reconhecida." } });

    const [{ data: entities, error: entitiesError }, { data: recurrences, error: recurrenceError }] = await Promise.all([
      client.from("dictionary_entity_summary").select("id, entity_type, canonical_name, governance_status, evidence_count").neq("governance_status", "consolidated").order("evidence_count", { ascending: false }).limit(100),
      client.from("recurrence_summary").select("sistema, processo, subprocesso, categoria_problema, occurrences").gt("occurrences", 1).order("occurrences", { ascending: false }).limit(30),
    ]);
    if (entitiesError || recurrenceError) throw entitiesError ?? recurrenceError;

    const rows = ((entities ?? []) as EntitySummary[]);
    const validIds = new Set(rows.map((entity) => entity.id));
    const byId = new Map(rows.map((entity) => [entity.id, entity]));

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return reply(500, { error: { code: "evolution_unavailable", message: "Evolução indisponível: configure GEMINI_API_KEY." } });

    const prompt = `Você é um assessor de governança de conhecimento operacional. Gere no máximo 12 SUGESTÕES, nunca decisões. Use somente os IDs e dados fornecidos. Tipos: discover (homologar candidato recorrente), group (consolidar sinônimos prováveis do mesmo tipo), relate (relacionar duas entidades existentes) e refine (sugerir subcategoria para uma categoria atual). Responda somente JSON: {"suggestions":[{"type":"discover|group|relate|refine", "entity_id":"...", "source_entity_id":"...", "target_entity_id":"...", "evidence_count":0, "parent_category":"...", "proposed_category":"...", "rationale":"...", "evidence":["..."]}]}. Em cada item, preencha apenas os campos relevantes. Não invente IDs.\nENTIDADES: ${JSON.stringify(rows)}\nRECORRÊNCIAS: ${JSON.stringify(recurrences ?? [])}`;
    const provider = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0 } }),
    });
    if (!provider.ok) throw new Error(`gemini_${provider.status}`);
    const rawResponse = await provider.json().catch(() => null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawResponse?.candidates?.[0]?.content?.parts?.[0]?.text);
    } catch {
      parsed = null;
    }
    const candidates = Array.isArray((parsed as { suggestions?: unknown })?.suggestions) ? (parsed as { suggestions: unknown[] }).suggestions : [];
    const accepted: Array<{ suggestion_type: string; proposal: Record<string, unknown>; fingerprint: string; evidence: unknown[]; raw_response: unknown; prompt_version: string }> = [];
    const add = (suggestionType: string, proposal: Record<string, unknown>, evidence: unknown[]) => {
      accepted.push({ suggestion_type: suggestionType, proposal, fingerprint: JSON.stringify({ suggestion_type: suggestionType, proposal }), evidence, raw_response: rawResponse, prompt_version: PROMPT_VERSION });
    };
    for (const item of candidates.slice(0, 12)) {
      if (!item || typeof item !== "object") continue;
      const suggestion = item as Record<string, unknown>;
      const type = suggestion.type;
      const rationale = typeof suggestion.rationale === "string" ? suggestion.rationale.slice(0, 500) : "";
      const evidence = Array.isArray(suggestion.evidence) ? (suggestion.evidence as unknown[]).filter((value) => typeof value === "string").slice(0, 10) : [];
      if (type === "discover" && isKnownId(suggestion.entity_id, validIds) && byId.get(suggestion.entity_id as string)?.governance_status === "candidate") {
        add(type, { entity_id: suggestion.entity_id, rationale }, evidence);
      }
      if (type === "group" && isKnownId(suggestion.source_entity_id, validIds) && isKnownId(suggestion.target_entity_id, validIds) && suggestion.source_entity_id !== suggestion.target_entity_id && byId.get(suggestion.source_entity_id as string)?.entity_type === byId.get(suggestion.target_entity_id as string)?.entity_type) {
        add(type, { source_entity_id: suggestion.source_entity_id, target_entity_id: suggestion.target_entity_id, rationale }, evidence);
      }
      if (type === "relate" && isKnownId(suggestion.source_entity_id, validIds) && isKnownId(suggestion.target_entity_id, validIds) && suggestion.source_entity_id !== suggestion.target_entity_id) {
        add(type, { source_entity_id: suggestion.source_entity_id, target_entity_id: suggestion.target_entity_id, evidence_count: Math.max(0, Number(suggestion.evidence_count) || 0), rationale }, evidence);
      }
      if (type === "refine" && typeof suggestion.parent_category === "string" && typeof suggestion.proposed_category === "string" && suggestion.parent_category.trim().length >= 1 && suggestion.parent_category.trim().length <= 80 && suggestion.proposed_category.trim().length >= 1 && suggestion.proposed_category.trim().length <= 80) {
        add(type, { parent_category: suggestion.parent_category.trim(), proposed_category: suggestion.proposed_category.trim(), rationale }, evidence);
      }
    }
    if (accepted.length) {
      const { error } = await client.from("knowledge_suggestions").upsert(accepted, { onConflict: "fingerprint", ignoreDuplicates: true });
      if (error) throw error;
    }
    return reply(200, { created: accepted.length, ignored: candidates.length - accepted.length });
  } catch (error) {
    console.error("POC evolution failed", error instanceof Error ? error.message : "unexpected_error");
    return reply(500, { error: { code: "persistence_failed", message: "Não foi possível processar sugestões de evolução." } });
  }
});
