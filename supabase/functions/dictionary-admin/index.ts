import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TYPES = ["processo", "subprocesso", "sistema", "produto"];
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function normalized(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
function aliasText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean && clean.length <= 160 ? clean : null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return reply(405, { error: { code: "method_not_allowed", message: "Use POST." } });
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return reply(500, { error: { code: "persistence_failed", message: "Dicionário indisponível." } });
  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  try {
    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== "object") return reply(400, { error: { code: "invalid_json", message: "Envie um JSON válido." } });
    const operation = (payload as Record<string, unknown>).operation;

    if (operation === "list") {
      const { data, error } = await client.from("dictionary_entity_summary").select("*").order("governance_status").order("evidence_count", { ascending: false }).limit(200);
      if (error) throw error;
      return reply(200, { entities: data ?? [] });
    }

    const entityId = typeof (payload as Record<string, unknown>).entity_id === "string" ? (payload as Record<string, unknown>).entity_id as string : null;
    if (!entityId) return reply(400, { error: { code: "invalid_entity", message: "Entidade inválida." } });
    const { data: entity, error: entityError } = await client.from("entities").select("id, entity_type, canonical_name, governance_status").eq("id", entityId).single();
    if (entityError || !entity) return reply(404, { error: { code: "entity_not_found", message: "Entidade não encontrada." } });

    if (operation === "detail") {
      const [{ data: aliases }, { data: evidence }] = await Promise.all([
        client.from("entity_aliases").select("alias, created_at").eq("entity_id", entityId).order("alias"),
        client.from("entity_evidence").select("extracted_value, evidence_state, created_at, field_name, perception_id").eq("entity_id", entityId).order("created_at", { ascending: false }).limit(20),
      ]);
      return reply(200, { entity, aliases: aliases ?? [], evidence: evidence ?? [] });
    }
    if (operation === "homologate" || operation === "reject") {
      const next = operation === "homologate" ? "homologated" : "rejected";
      const stamp = operation === "homologate"
        ? { governance_status: next, homologated_at: new Date().toISOString(), rejected_at: null, updated_at: new Date().toISOString() }
        : { governance_status: next, rejected_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      const { error } = await client.from("entities").update(stamp).eq("id", entityId);
      if (error) throw error;
      await client.from("entity_governance_events").insert({ entity_id: entityId, action: next });
      return reply(200, { status: next });
    }
    if (operation === "add_alias") {
      const alias = aliasText((payload as Record<string, unknown>).alias);
      if (!alias) return reply(400, { error: { code: "invalid_alias", message: "Sinônimo inválido." } });
      const { error } = await client.from("entity_aliases").insert({ entity_id: entityId, entity_type: entity.entity_type, alias, normalized_alias: normalized(alias) });
      if (error) return reply(409, { error: { code: "alias_conflict", message: "Este sinônimo já existe ou conflita com outra entidade." } });
      await client.from("entity_governance_events").insert({ entity_id: entityId, action: "alias_added", details: { alias } });
      return reply(201, { status: "alias_added" });
    }
    if (operation === "consolidate") {
      const targetId = typeof (payload as Record<string, unknown>).target_entity_id === "string" ? (payload as Record<string, unknown>).target_entity_id as string : null;
      if (!targetId || targetId === entityId) return reply(400, { error: { code: "invalid_target", message: "Selecione outra entidade do mesmo tipo." } });
      const { data: target } = await client.from("entities").select("id, entity_type, governance_status").eq("id", targetId).single();
      if (!target || target.entity_type !== entity.entity_type || target.governance_status === "consolidated" || !TYPES.includes(target.entity_type)) {
        return reply(400, { error: { code: "invalid_target", message: "Destino deve existir, ter o mesmo tipo e estar ativo." } });
      }
      const { error } = await client.rpc("consolidate_entities", { p_source_id: entityId, p_target_id: targetId, p_actor_id: null });
      if (error) throw error;
      return reply(200, { status: "consolidated", target_entity_id: targetId });
    }
    return reply(400, { error: { code: "unknown_operation", message: "Operação não reconhecida." } });
  } catch (error) {
    console.error("POC dictionary failed", error instanceof Error ? error.message : "unexpected_error");
    return reply(500, { error: { code: "persistence_failed", message: "Não foi possível atualizar o dicionário." } });
  }
});
