import test from "node:test";
import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("configuração pública não contém secrets de servidor", async () => {
  const config = await read("js/config.js");
  assert.doesNotMatch(config, /SUPABASE_SERVICE_ROLE_KEY|GEMINI_API_KEY/i);
});

test("frontend POC não tem login nem sessão", async () => {
  const [html, app, api, admin, analytics, semantic, evolution] = await Promise.all([
    read("index.html"),
    read("js/app.js"),
    read("js/api.js"),
    read("js/admin.js"),
    read("js/analytics.js"),
    read("js/semantic.js"),
    read("js/evolution.js"),
  ]);
  for (const source of [html, app, admin, analytics, semantic, evolution]) {
    assert.doesNotMatch(source, /login-form|password|Entrar|signIn|signOut/i);
  }
  assert.doesNotMatch(app, /auth\.js|hasSession|signIn|signOut/);
  assert.doesNotMatch(api, /auth\.js|accessToken|signIn|signOut/);
  assert.match(api, /Authorization: `Bearer \${supabaseAnonKey}`/);
  assert.match(api, /analyze-perception/);
  assert.match(api, /record-perception/);
  assert.match(api, /dictionary-admin/);
  assert.match(api, /operational-analytics/);
  assert.match(api, /semantic-intelligence/);
  assert.match(api, /knowledge-evolution/);
});

test("modelo Gemini padrão é explicitamente configurável", async () => {
  const source = await read("supabase/functions/analyze-perception/index.ts");
  assert.match(source, /Deno\.env\.get\("GEMINI_MODEL"\)/);
  assert.match(source, /gemini-3\.5-flash-lite/);
});

test("analista conduz a conversa antes de liberar validação", async () => {
  const source = await read("supabase/functions/analyze-perception/index.ts");
  assert.match(source, /ready_for_validation/);
  assert.match(source, /5W2H/);
  assert.match(source, /createAnalysisSession\(history, rawResponse, dialogue\)/);
  assert.match(source, /for \(let attempt = 0; attempt < 2/);
});

test("Edge Functions do POC são abertas e enxutas", async () => {
  const [analyze, record, dictionary, analytics, semantic, evolution] = await Promise.all([
    read("supabase/functions/analyze-perception/index.ts"),
    read("supabase/functions/record-perception/index.ts"),
    read("supabase/functions/dictionary-admin/index.ts"),
    read("supabase/functions/operational-analytics/index.ts"),
    read("supabase/functions/semantic-intelligence/index.ts"),
    read("supabase/functions/knowledge-evolution/index.ts"),
  ]);
  for (const source of [analyze, record, dictionary, analytics, semantic, evolution]) {
    assert.match(source, /Access-Control-Allow-Origin": "\*"/);
    assert.doesNotMatch(source, /authorize|user_roles|consume_edge_rate_limit|ALLOWED_ORIGIN/);
  }
});

test("pontos evolutivos 2-4 preservam auditoria e não decidem sozinhos", async () => {
  const [dictionary, semantic, migration] = await Promise.all([
    read("supabase/functions/dictionary-admin/index.ts"),
    read("supabase/functions/semantic-intelligence/index.ts"),
    read("supabase/migrations/20261002000000_poc_dictionary.sql"),
  ]);
  assert.match(dictionary, /entity_governance_events/);
  assert.match(dictionary, /consolidate_entities/);
  assert.match(semantic, /semantic_similar_pairs/);
  assert.match(semantic, /operational_anomalies/);
  assert.match(semantic, /gemini-embedding-001/);
  assert.match(migration, /register_entity_evidence/);
});

test("produto é quarto eixo operacional (livre, opcional, com dicionário)", async () => {
  const [analyze, record, dictionary, analytics, migration, app, analyticsJs] = await Promise.all([
    read("supabase/functions/analyze-perception/index.ts"),
    read("supabase/functions/record-perception/index.ts"),
    read("supabase/functions/dictionary-admin/index.ts"),
    read("supabase/functions/operational-analytics/index.ts"),
    read("supabase/migrations/20261009000000_poc_produto.sql"),
    read("js/app.js"),
    read("js/analytics.js"),
  ]);
  assert.match(analyze, /"produto"/);
  assert.match(record, /"produto"/);
  assert.match(dictionary, /"produto"/);
  assert.match(analytics, /by_product/);
  assert.match(migration, /produto/);
  assert.match(migration, /operational_anomalies/);
  assert.match(app, /produto/);
  assert.match(analyticsJs, /by_product/);
  assert.doesNotMatch(analyze, /Consorcio|Consórcio|CDC/);
});

test("MVP5 aberto sugere sem decidir; humano aprova em tela", async () => {
  const [evolution, migration, frontend] = await Promise.all([
    read("supabase/functions/knowledge-evolution/index.ts"),
    read("supabase/migrations/20261003000000_poc_knowledge.sql"),
    read("js/evolution.js"),
  ]);
  assert.match(evolution, /knowledge_suggestions/);
  assert.match(evolution, /review_knowledge_suggestion/);
  assert.match(evolution, /poc-evolution\.0/);
  assert.match(migration, /review_knowledge_suggestion/);
  assert.match(migration, /entity_relations/);
  assert.match(migration, /taxonomy_refinements/);
  assert.match(frontend, /evolutionOperation\("list"/);
  assert.match(frontend, /evolutionOperation\("review"/);
  assert.match(frontend, /evolutionOperation\("generate"/);
});
