import { taxonomy } from "./taxonomy.generated.mjs";
export { taxonomy };
export const CONTRACT_VERSION = "classification.1";
export const FIELDS = ["tipo", "processo", "subprocesso", "sistema", "produto", "categoria_problema"];
export const ENTITY_FIELDS = Object.keys(taxonomy.entities);
const nonempty = (maxLength) => ({ type: "string", minLength: 1, maxLength, pattern: "\\S" });
const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const object = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const reference = object({ message_index: { type: "integer", minimum: 0, maximum: 11 }, quote: nonempty(2000) });
const field = (name) => object({
  value: nullable(name === "tipo" ? { enum: Object.keys(taxonomy.types) } : name === "categoria_problema" ? { enum: Object.keys(taxonomy.categories) } : nonempty(160)),
  entity_id: nullable(nonempty(100)),
  evidence: { enum: ["observed", "inferred", "suggested", "none"] },
  sources: { type: "array", maxItems: 12, items: reference },
  resolution: { enum: ["known", "new", "ambiguous", "absent", "not_applicable", "unresolved"] },
  pending_reason: nullable(nonempty(500)),
  confidence: nullable({ type: "number", minimum: 0, maximum: 1 }),
});

// Authoritative schema; exportable as JSON without an additional dependency.
export const classificationSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:operational-intelligence:classification:1",
  ...object({
    contract_version: { const: CONTRACT_VERSION },
    taxonomy_version: { const: taxonomy.version },
    single_issue: { type: "boolean" },
    assistant_message: nonempty(900),
    ready_for_validation: { type: "boolean" },
    summary: nullable(nonempty(1200)),
    clarification_question: nullable(nonempty(500)),
    confirmation_required: { const: true },
    fields: object(Object.fromEntries(FIELDS.map((name) => [name, field(name)]))),
  }),
};

// Only the vocabulary used by classificationSchema is implemented here.
// This is not a general purpose JSON Schema engine.
function validateShape(value, schema, path, errors) {
  const fail = (code) => errors.push(`${path}:${code}`);
  if (schema.anyOf) {
    if (!schema.anyOf.some((branch) => { const e = []; validateShape(value, branch, path, e); return e.length === 0; })) fail("anyOf");
    return;
  }
  if ("const" in schema && value !== schema.const) fail("const");
  if (schema.enum && !schema.enum.includes(value)) fail("enum");
  if (schema.type) {
    const matches = schema.type === "null" ? value === null
      : schema.type === "array" ? Array.isArray(value)
      : schema.type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value)
      : schema.type === "integer" ? Number.isInteger(value)
      : schema.type === "number" ? typeof value === "number" && Number.isFinite(value)
      : typeof value === schema.type;
    if (!matches) { fail("type"); return; }
  }
  if (typeof value === "string") {
    if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) fail("length");
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail("blank");
  }
  if (typeof value === "number" && (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) fail("range");
  if (schema.type === "array") {
    if (value.length > schema.maxItems) fail("maxItems");
    value.forEach((item, i) => validateShape(item, schema.items, `${path}[${i}]`, errors));
  }
  if (schema.type === "object") {
    for (const key of schema.required) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}:required`);
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, key)) errors.push(`${path}.${key}:additionalProperty`);
      else validateShape(item, schema.properties[key], `${path}.${key}`, errors);
    }
  }
}

export function validateClassification(value, { messages = [], entities = [] } = {}) {
  const errors = [];
  validateShape(value, classificationSchema, "$", errors);
  if (errors.length) return { valid: false, errors };
  for (const name of FIELDS) {
    const f = value.fields[name];
    const fail = (reason) => errors.push(`$.fields.${name}:${reason}`);
    const isEntity = ENTITY_FIELDS.includes(name);
    for (const source of f.sources) {
      const message = messages[source.message_index];
      if (!message || message.role !== "user" || typeof message.text !== "string" || !message.text.includes(source.quote)) fail("source_not_in_user_message");
    }
    if (f.value !== null && (f.evidence === "none" || !f.sources.length)) fail("missing_evidence");
    if (["absent", "not_applicable"].includes(f.resolution) && (f.value !== null || f.entity_id !== null || f.evidence !== "none" || f.sources.length !== 0 || f.confidence !== null)) fail("empty_state_has_value");
    if (f.value === null && !["absent", "not_applicable", "ambiguous"].includes(f.resolution)) fail("null_value_state");
    if (f.resolution === "ambiguous" && f.value !== null) fail("ambiguous_must_abstain");
    if (["ambiguous", "unresolved", "new"].includes(f.resolution) && !f.pending_reason) fail("missing_pending_reason");
    if (!isEntity && (f.entity_id !== null || !["known", "ambiguous", "absent"].includes(f.resolution))) fail("invalid_taxonomy_resolution");
    if (isEntity && f.resolution === "known") {
      if (!entities.some((e) => e.id === f.entity_id && e.entity_type === name && e.governance_status === "homologated")) fail("unknown_or_unapproved_entity");
    } else if (f.entity_id !== null) fail("entity_id_without_known_resolution");
    if (value.ready_for_validation && (f.resolution === "ambiguous" || f.evidence === "suggested")) fail("unresolved_hypothesis");
  }
  if (!value.single_issue && (value.ready_for_validation || !value.clarification_question)) errors.push("$:multiple_issues_require_question");
  if (value.ready_for_validation) {
    if (!value.single_issue || !value.summary || value.clarification_question !== null) errors.push("$:invalid_ready_state");
    for (const name of ["tipo", "categoria_problema"]) if (value.fields[name].resolution !== "known" || value.fields[name].value === null) errors.push(`$.fields.${name}:required_for_review`);
  } else if (value.summary !== null || !value.clarification_question) errors.push("$:clarification_required");
  return { valid: errors.length === 0, errors };
}
