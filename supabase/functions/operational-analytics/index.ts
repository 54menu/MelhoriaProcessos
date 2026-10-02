import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return reply(405, { error: { code: "method_not_allowed", message: "Use POST." } });
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return reply(500, { error: { code: "persistence_failed", message: "Indicadores indisponíveis." } });
  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  try {
    await request.json().catch(() => null);
    const [summaryResult, dailyResult] = await Promise.all([
      client.from("recurrence_summary").select("*").order("occurrences", { ascending: false }).limit(50),
      client.from("recurrence_daily").select("*").order("occurrence_date", { ascending: false }).limit(200),
    ]);
    if (summaryResult.error || dailyResult.error) throw summaryResult.error ?? dailyResult.error;
    const rows = (summaryResult.data ?? []) as Array<Record<string, unknown>>;
    const grouped = (key: string) => Object.entries(rows.reduce((acc: Record<string, number>, row) => {
      const name = String(row[key] ?? "Não informado");
      acc[name] = (acc[name] ?? 0) + Number(row.occurrences);
      return acc;
    }, {})).map(([name, occurrences]) => ({ name, occurrences })).sort((a, b) => b.occurrences - a.occurrences);
    return reply(200, {
      total_validated_perceptions: rows.reduce((total, row) => total + Number(row.occurrences), 0),
      recurring_combinations: rows.filter((row) => Number(row.occurrences) > 1).length,
      top_recurrences: rows,
      by_system: grouped("sistema"),
      by_process: grouped("processo"),
      daily_evolution: (dailyResult.data ?? []).reverse(),
      unit_coverage: { available: false, message: "Unidade não é coletada no fluxo atual; não há concentração por unidade a reportar." },
      note: "Recorrência = combinação exata de campos. Equivalência semântica está em semantic-intelligence.",
    });
  } catch (error) {
    console.error("POC analytics failed", error instanceof Error ? error.message : "unexpected_error");
    return reply(500, { error: { code: "persistence_failed", message: "Não foi possível gerar os indicadores." } });
  }
});
