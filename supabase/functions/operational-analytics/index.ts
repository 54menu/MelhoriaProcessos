import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return new Response(JSON.stringify({ error: { message: "Use POST." } }), { status: 405, headers });
  await request.json().catch(() => null);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) throw new Error("persistence_not_configured");
    const { data, error } = await createClient(url, key, { auth: { persistSession: false } })
      .rpc("canonical_operational_analytics").abortSignal(AbortSignal.timeout(15000));
    // Totals and by_product/by_system/by_process are computed over the full base in SQL.
    if (error || !data) throw new Error("analytics_unavailable");
    return new Response(JSON.stringify(data), { status: 200, headers });
  } catch {
    return new Response(JSON.stringify({ error: { code: "persistence_failed", message: "Não foi possível gerar os indicadores." } }), { status: 500, headers });
  }
});
