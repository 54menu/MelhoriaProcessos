import { FIELDS, ENTITY_FIELDS, taxonomy } from "./classification-contract.mjs";

export const normalize = (text) => String(text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
const tokens = (text) => new Set(normalize(text).split(" ").filter(t => t.length > 2 && !["para", "como", "uma", "que", "nao", "por", "com", "dos", "das"].includes(t)));
const mention = (text, name) => normalize(name).length > 1 && ` ${normalize(text)} `.includes(` ${normalize(name)} `);
const overlap = (a, b) => { const left = tokens(a); const right = tokens(b); return [...left].filter(t => right.has(t)).length / Math.max(1, Math.min(left.size, right.size)); };

export function approvedExamples(catalog) {
  if (!catalog || !Array.isArray(catalog.examples)) throw new Error("invalid_example_catalog");
  const seen = new Set();
  return catalog.examples.filter(example => {
    if (example.status !== "approved") return false;
    if (typeof example.id !== "string" || !example.id || seen.has(example.id) || typeof example.reviewed_by !== "string" || !example.reviewed_by.trim() || !Number.isFinite(Date.parse(example.reviewed_at)) || example.taxonomy_version !== taxonomy.version || typeof example.text !== "string" || !example.text.trim() || example.text.length > 2000 || !example.classification) throw new Error("invalid_approved_example");
    for (const name of FIELDS) {
      const v = example.classification[name];
      if (name === "tipo" ? !Object.hasOwn(taxonomy.types, v) : name === "categoria_problema" ? !Object.hasOwn(taxonomy.categories, v) : !(v === null || (typeof v === "string" && v.trim() && v.length <= 160))) throw new Error("invalid_example_classification");
    }
    seen.add(example.id); return true;
  });
}

export function selectContext(messages, snapshot, catalog, semanticEntityIds = []) {
  const text = messages.filter(m => m.role === "user").map(m => m.text).join("\n");
  const approved = snapshot.entities.filter(e => e.governance_status === "homologated");
  const aliases = snapshot.aliases.filter(a => approved.some(e => e.id === a.entity_id && e.entity_type === a.entity_type));
  const semantic = new Set(semanticEntityIds);
  const entities = approved.map(e => {
    const names = [e.canonical_name, ...aliases.filter(a => a.entity_id === e.id).map(a => a.alias)];
    const exact = names.some(n => mention(text, n));
    const lexical = Math.max(0, ...names.map(n => overlap(text, n)));
    return { ...e, score: exact ? 3 : semantic.has(e.id) ? 2 : lexical >= 0.5 ? lexical : 0, retrieval: exact ? "name_or_alias" : semantic.has(e.id) ? "semantic_candidate" : "lexical_candidate" };
  }).filter(e => e.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 30);
  const ids = new Set(entities.map(e => e.id));
  const examples = approvedExamples(catalog).map(e => ({ ...e, score: overlap(text, e.text) })).filter(e => e.score >= 0.2).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 4);
  return {
    entities: entities.map(({ score, ...e }) => e),
    aliases: aliases.filter(a => ids.has(a.entity_id)).slice(0, 120),
    examples: examples.map(({ score, ...e }) => e),
    examples_version: catalog.version,
    retrieval_complete: snapshot.complete,
  };
}

export function resolveEntities(classification, snapshot) {
  const output = structuredClone(classification);
  const decisions = [];
  for (const name of ENTITY_FIELDS) {
    const f = output.fields[name];
    if (!f.value) continue;
    const term = normalize(f.value);
    // Canonical names AND aliases: neither may silently hide a collision.
    const matching = snapshot.entities.filter(e => e.entity_type === name && (normalize(e.canonical_name) === term || snapshot.aliases.some(a => a.entity_id === e.id && a.entity_type === name && normalize(a.alias) === term)));
    const approved = matching.filter(e => e.governance_status === "homologated");
    f.entity_id = null;
    if (approved.length === 1 && matching.length === 1 && snapshot.complete) {
      f.resolution = "known"; f.entity_id = approved[0].id; f.pending_reason = null;
    } else if (matching.length > 1) {
      f.value = null; f.resolution = "ambiguous"; f.pending_reason = "Nome ou alias corresponde a mais de uma entidade; confirme a identificação.";
    } else if (!snapshot.complete || matching.length) {
      f.resolution = "unresolved"; f.pending_reason = snapshot.complete ? "O termo existe, mas não está homologado; requer curadoria." : "Consulta limitada; não é possível assegurar correspondência única nem declarar conceito novo.";
    } else {
      f.resolution = "new"; f.pending_reason = "Sem correspondência exata ou alias no dicionário consultado; candidato para curadoria, não homologado.";
    }
    decisions.push({ field: name, resolution: f.resolution, entity_id: f.entity_id });
  }
  const ambiguity = ENTITY_FIELDS.find(name => output.fields[name].resolution === "ambiguous");
  if (ambiguity && output.ready_for_validation) {
    output.ready_for_validation = false; output.summary = null;
    output.clarification_question = `Pode especificar a qual ${ambiguity} você se refere?`;
    output.assistant_message = output.clarification_question;
  }
  return { output, decisions };
}

async function paged(client, table, columns, cap, signal) {
  const result = []; const size = 500;
  for (let start = 0; start < cap; start += size) {
    const { data, error } = await client.from(table).select(columns).order("id").range(start, Math.min(start + size, cap) - 1).abortSignal(signal);
    if (error || !Array.isArray(data)) throw new Error("knowledge_unavailable");
    result.push(...data);
    if (data.length < size) return { rows: result, complete: true };
  }
  return { rows: result, complete: false };
}

export async function loadDictionary(client, signal) {
  const [entities, aliases] = await Promise.all([
    paged(client, "entities", "id,entity_type,canonical_name,governance_status,updated_at", 2000, signal),
    paged(client, "entity_aliases", "id,entity_id,entity_type,alias", 4000, signal),
  ]);
  return { entities: entities.rows, aliases: aliases.rows, complete: entities.complete && aliases.complete };
}

export async function semanticCandidates(client, vector, model, signal) {
  const { data, error } = await client.rpc("semantic_neighbors", { p_embedding: `[${vector.join(",")}]`, p_threshold: 0.72, p_limit: 12 }).abortSignal(signal);
  if (error || !Array.isArray(data)) throw new Error("semantic_unavailable");
  const ids = data.map(row => row.perception_id);
  if (!ids.length) return [];
  // Existing RPC has no model filter; exclude incompatible vectors before using results.
  const { data: compatible, error: modelError } = await client.from("perception_embeddings").select("perception_id").in("perception_id", ids).eq("embedding_model", model).abortSignal(signal);
  if (modelError || !Array.isArray(compatible)) throw new Error("semantic_unavailable");
  if (!compatible.length) return [];
  const { data: evidence, error: evidenceError } = await client.from("entity_evidence").select("entity_id").in("perception_id", compatible.map(row => row.perception_id)).limit(100).abortSignal(signal);
  if (evidenceError || !Array.isArray(evidence)) throw new Error("semantic_unavailable");
  return [...new Set(evidence.map(row => row.entity_id))];
}
