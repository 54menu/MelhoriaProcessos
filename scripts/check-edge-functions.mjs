import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";

const functions = ["analyze-perception", "record-perception", "dictionary-admin", "operational-analytics", "semantic-intelligence"];

for (const name of functions) {
  const source = await readFile(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), "utf8");
  assert.match(source, /request\.json\(\)\.catch\(\(\) => null\)/, `${name}: JSON malformado deve ser tratado`);
  assert.match(source, /Access-Control-Allow-Origin": "\*"/, `${name}: POC usa CORS aberto`);
  assert.doesNotMatch(source, /authorize\(|user_roles|consume_edge_rate_limit|ALLOWED_ORIGIN/, `${name}: POC não deve ter auth/roles/rate-limit`);
}
