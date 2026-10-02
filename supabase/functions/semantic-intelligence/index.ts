import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DIMENSIONS = 768;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function vector(values: unknown): string | null {
  if (!Array.isArray(values) || values.length !== DIMENSIONS) return null;
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  return `[${values.join(",")}]`;
}
async function embed(text: string, apiKey: string, model: string): Promise<string> {
  const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ model: `models/${model}`, content: { parts: [{ text }] }, embedContentConfig: { taskType: "SEMANTIC_SIMILARITY", outputDimensionality: DIMENSIONS } }),
  });
  if (!upstream.ok) throw new Error(`embedding_${upstream.status}`);
  const data = await upstream.json().catch(() => null);
  const result = vector(data?.embedding?.values);
  if (!result) throw new Error("invalid_embedding_response");
  return result;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return reply(405, { error: { code: "method_not_allowed", message: "Use POST." } });
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return reply(500, { error: { code: "persistence_failed", message: "Busca semântica indisponível." } });
  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  try {
    const payload = await request.json().catch(() => null);
    const operation = payload && typeof payload === "object" ? (payload as Record<string, unknown>).operation : null;
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    const model = Deno.env.get("GEMINI_EMBEDDING_MODEL") ?? "gemini-embedding-001";

    if (operation === "insights") {
      const [{ data: pairs, error: pairsError }, { data: anomalies, error: anomaliesError }, { count, error: countError }] = await Promise.all([
        client.rpc("semantic_similar_pairs", { p_threshold: 0.84, p_limit: 100 }),
        client.rpc("operational_anomalies"),
        client.from("perception_embeddings").select("*", { count: "exact", head: true }),
      ]);
      if (pairsError || anomaliesError || countError) throw pairsError ?? anomaliesError ?? countError;
      return reply(200, {
        embedded_perceptions: count ?? 0,
        semantic_pairs: pairs ?? [],
        anomalies: anomalies ?? [],
        warning: "Similaridade é sinal, não decisão. Pares não alteram classificação nem dicionário.",
      });
    }
    if (!apiKey) return reply(500, { error: { code: "embedding_unavailable", message: "Embedding indisponível: configure GEMINI_API_KEY." } });
    if (operation === "search") {
      const query = typeof (payload as Record<string, unknown>)?.query === "string" ? String((payload as Record<string, unknown>).query).trim() : "";
      if (!query || query.length > 2000) return reply(400, { error: { code: "invalid_query", message: "Informe uma busca de até 2.000 caracteres." } });
      const embedding = await embed(query, apiKey, model);
      const { data, error } = await client.rpc("semantic_neighbors", { p_embedding: embedding, p_threshold: 0.72, p_limit: 20 });
      if (error) throw error;
      return reply(200, { matches: data ?? [] });
    }
    if (operation === "backfill") {
      const { data: pending, error } = await client.rpc("unembedded_perceptions", { p_limit: 20 });
      if (error) throw error;
      const rows = [];
      for (const item of (pending ?? []) as Array<{ perception_id: string; original_text: string }>) {
        const embedding = await embed(item.original_text, apiKey, model);
        rows.push({ perception_id: item.perception_id, embedding, embedding_model: model, source_text: item.original_text });
      }
      if (rows.length) {
        const { error: insertError } = await client.from("perception_embeddings").upsert(rows, { onConflict: "perception_id" });
        if (insertError) throw insertError;
      }
      return reply(200, { embedded: rows.length, remaining_batch_available: (pending ?? []).length === 20 });
    }
    return reply(400, { error: { code: "unknown_operation", message: "Operação não reconhecida." } });
  } catch (error) {
    console.error("POC semantic failed", error instanceof Error ? error.message : "unexpected_error");
    return reply(502, { error: { code: "upstream_failure", message: "Não foi possível processar a inteligência semântica." } });
  }
});
