import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";
import { createHandler } from "../_shared/classification-pipeline.mjs";
import { loadDictionary, semanticCandidates } from "../_shared/knowledge-context.mjs";
import { invokeGemini, embedQuery } from "../_shared/classification-provider.mjs";
import { exampleCatalog } from "../_shared/examples.generated.mjs";
import { loadCuratedExamples } from "../_shared/curated-examples.mjs";
import { loadReviewPolicy } from "../_shared/selective-review.mjs";

const MODEL = Deno.env.get("CLASSIFICATION_MODEL") || Deno.env.get("GEMINI_MODEL") || "gemini-3.5-flash-lite";
const EMBEDDING_MODEL = Deno.env.get("GEMINI_EMBEDDING_MODEL") ?? "gemini-embedding-001";

Deno.serve(createHandler(() => {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!url || !serviceKey) throw new Error("persistence_not_configured");
  if (!apiKey) throw new Error("gemini_not_configured");
  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  return {
    model: MODEL,
    catalog: exampleCatalog,
    repository: {
      loadReviewPolicy: (signal: AbortSignal) => loadReviewPolicy(client, signal),
      recordAnalysisEvent: async (row: Record<string, unknown>, signal: AbortSignal) => {
        const { error } = await client.from('classification_analysis_events').insert(row).abortSignal(signal);
        if (error) throw new Error('analysis_monitoring_unavailable');
      },
      loadDictionary: (signal: AbortSignal) => loadDictionary(client, signal),
      loadCatalog: (signal: AbortSignal) => loadCuratedExamples(client, signal),
      createSession: async (row: Record<string, unknown>, signal: AbortSignal) => {
        const { data, error } = await client.from("analysis_sessions").insert(row).select("id").single().abortSignal(signal);
        if (error || !data?.id) throw new Error("analysis_session_failed");
        return data.id;
      },
    },
    provider: (input: Parameters<typeof invokeGemini>[0]) => invokeGemini({ ...input, apiKey, model: MODEL }),
    semanticSearch: Deno.env.get("CLASSIFICATION_SEMANTIC_ENABLED") === "false" ? null : async (messages: Array<{ role: string; text: string }>, signal: AbortSignal) => {
      const text = messages.filter(m => m.role === "user").map(m => m.text).join("\n");
      const embedding = await embedQuery(text, { apiKey, model: EMBEDDING_MODEL, signal });
      return semanticCandidates(client, embedding, EMBEDDING_MODEL, signal);
    },
  };
}));
