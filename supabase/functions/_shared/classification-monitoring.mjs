export function createMonitoringHandler(readReport) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json; charset=utf-8' };
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
  return async request => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply(405, { error: { message: 'Use POST.' } });
    const payload = await request.json().catch(() => null);
    if (!payload || ![7,30,90].includes(payload.days ?? 30) || Object.keys(payload).some(k => k !== 'days')) return reply(400, { error: { message: 'Escolha 7, 30 ou 90 dias.' } });
    try { return reply(200, await readReport(payload.days ?? 30)); }
    catch { return reply(503, { error: { message: 'Não foi possível consultar o acompanhamento. Tente novamente.' } }); }
  };
}
