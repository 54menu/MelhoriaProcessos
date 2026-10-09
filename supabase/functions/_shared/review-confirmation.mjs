import { FIELDS, taxonomy } from "./classification-contract.mjs";

export function parseConfirmation(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (typeof payload.analysis_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.analysis_id)) return null;
  const c = payload.classification;
  if (!c || typeof c !== "object" || Array.isArray(c) || Object.keys(c).length !== FIELDS.length || !FIELDS.every(f => Object.hasOwn(c,f))) return null;
  const classification = {};
  for (const field of FIELDS) {
    const value = c[field];
    if (!(value === null || typeof value === "string") || (typeof value === "string" && value.trim().length > 160)) return null;
    classification[field] = typeof value === "string" ? value.trim() || null : null;
  }
  if (!Object.hasOwn(taxonomy.types, classification.tipo) || !Object.hasOwn(taxonomy.categories, classification.categoria_problema)) return null;
  if (typeof payload.summary !== "string" || !payload.summary.trim() || payload.summary.trim().length > 1200) return null;
  if (typeof payload.reviewer_label !== "string" || !payload.reviewer_label.trim() || payload.reviewer_label.trim().length > 120) return null;
  return { p_session_id: payload.analysis_id, p_classification: classification, p_summary: payload.summary.trim(), p_reviewer_label: payload.reviewer_label.trim() };
}

export function createRecordHandler(persist) {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json; charset=utf-8" };
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
  return async request => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return reply(405, { error: { code: "method_not_allowed", message: "Use POST." } });
    const payload = await request.json().catch(() => null);
    const args = parseConfirmation(payload);
    if (!args) return reply(400, { error: { code: "invalid_confirmation", message: "Confira os campos, o resumo e a identificação de quem revisou." } });
    try {
      const id = await persist(args);
      return reply(201, { perception_id: id, status: "validated" });
    } catch (error) {
      const expired = error instanceof Error && error.message.includes("analysis_session_unavailable");
      return reply(expired ? 409 : 500, { error: { code: expired ? "analysis_session_unavailable" : "persistence_failed", message: expired ? "Esta revisão expirou ou já foi registrada com outros valores. Inicie uma nova análise." : "Não foi possível confirmar o registro. Você pode tentar novamente com os mesmos dados." } });
    }
  };
}
