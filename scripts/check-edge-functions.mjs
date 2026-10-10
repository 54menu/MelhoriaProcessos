import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";

const functions = ["analyze-perception", "record-perception", "dictionary-admin", "operational-analytics", "semantic-intelligence", "knowledge-evolution", "knowledge-curation", "classification-monitoring"];

for (const name of functions) {
  const entry = await readFile(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), "utf8");
  const shared = { "analyze-perception": "classification-pipeline.mjs", "record-perception": "review-confirmation.mjs", "knowledge-curation": "curated-examples.mjs", "classification-monitoring": "classification-monitoring.mjs" }[name];
  const source = shared ? entry + await readFile(new URL(`../supabase/functions/_shared/${shared}`, import.meta.url), "utf8") : entry;
  assert.match(source, /request\.json\(\)\.catch\(\(\)\s*=>\s*null\)/, `${name}: JSON malformado deve ser tratado`);
  assert.match(source, /Access-Control-Allow-Origin["']:\s*["']\*["']/, `${name}: POC usa CORS aberto`);
  assert.doesNotMatch(source, /authorize\(|user_roles|consume_edge_rate_limit|ALLOWED_ORIGIN/, `${name}: POC não deve ter auth/roles/rate-limit`);
}
