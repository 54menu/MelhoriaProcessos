import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TYPES = ["reclamacao", "sugestao", "duvida", "elogio", "outro"];
const CATEGORIES = ["erro", "lentidao", "acesso", "usabilidade", "integracao", "processo", "informacao", "outro"];
const FIELDS = ["tipo", "processo", "subprocesso", "sistema", "produto", "categoria_problema"];
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

type Classification = { tipo: string; processo: string | null; subprocesso: string | null; sistema: string | null; produto: string | null; categoria_problema: string };

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function cleanText(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const clean = value.trim();
  return clean ? clean.slice(0, 160) : null;
}
function validClassification(value: unknown): value is Classification {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  if (!FIELDS.every((field) => field in data)) return false;
  const processo = cleanText(data.processo); const subprocesso = cleanText(data.subprocesso); const sistema = cleanText(data.sistema); const produto = cleanText(data.produto);
  return typeof data.tipo === "string" && TYPES.includes(data.tipo) && typeof data.categoria_problema === "string" && CATEGORIES.includes(data.categoria_problema) && processo !== undefined && subprocesso !== undefined && sistema !== undefined && produto !== undefined;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return reply(405, { error: { code: "method_not_allowed", message: "Use POST." } });
  const url = Deno.env.get("SUPABASE_URL"); const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return reply(500, { error: { code: "persistence_failed", message: "Não foi possível registrar a percepção." } });
  const serviceClient = createClient(url, serviceKey, { auth: { persistSession: false } });
  try {
    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== "object") return reply(400, { error: { code: "invalid_json", message: "Envie um JSON válido." } });
    if (typeof payload?.analysis_id !== "string" || !validClassification(payload?.classification)) {
      return reply(400, { error: { code: "invalid_confirmation", message: "Revise os campos obrigatórios antes de confirmar." } });
    }
    const classification = payload.classification as Record<string, unknown>;
    const canonical = {
      tipo: classification.tipo,
      processo: cleanText(classification.processo),
      subprocesso: cleanText(classification.subprocesso),
      sistema: cleanText(classification.sistema),
      produto: cleanText(classification.produto),
      categoria_problema: classification.categoria_problema,
    };
    const { data, error } = await serviceClient.rpc("persist_validated_perception", { p_session_id: payload.analysis_id, p_classification: canonical });
    if (error) {
      const code = error.message.includes("analysis_session_unavailable") ? "analysis_session_unavailable" : "persistence_failed";
      return reply(code === "analysis_session_unavailable" ? 409 : 500, { error: { code, message: code === "analysis_session_unavailable" ? "Esta análise expirou ou já foi confirmada. Faça uma nova interpretação." : "Não foi possível registrar a percepção." } });
    }
    return reply(201, { perception_id: data, status: "validated" });
  } catch (error) {
    console.error("POC record failed", error instanceof Error ? error.message : "unexpected_error");
    return reply(500, { error: { code: "persistence_failed", message: "Não foi possível registrar a percepção." } });
  }
});
