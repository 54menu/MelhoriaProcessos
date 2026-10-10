import { FIELDS, ENTITY_FIELDS } from './classification-contract.mjs';

export const POLICY_VERSION = 'selective-review.1';
export const DEFAULT_POLICY = Object.freeze({ version: POLICY_VERSION, revision: 1, simplified_review_enabled: true });

export function validateReviewPolicy(policy) {
  if (!policy || policy.version !== POLICY_VERSION || !Number.isSafeInteger(policy.revision) || policy.revision < 1 || typeof policy.simplified_review_enabled !== 'boolean') throw new Error('review_policy_unavailable');
  return policy;
}

// Called only after contract validation and server-side entity resolution.
// Model confidence deliberately has no role in this decision.
export function decideReview(output, knowledge, policy = DEFAULT_POLICY) {
  validateReviewPolicy(policy);
  const reasons = [];
  if (!output.single_issue) reasons.push('multiple_issues');
  if (!output.ready_for_validation) reasons.push('clarification_required');
  if (!knowledge.complete) reasons.push('incomplete_dictionary');
  const attention = FIELDS.filter(name => {
    const field = output.fields[name];
    return !field || ['inferred', 'suggested'].includes(field.evidence) || ['new', 'ambiguous', 'unresolved'].includes(field.resolution);
  });
  if (attention.length) reasons.push('fields_require_review');
  const grounded = FIELDS.every(name => {
    const f = output.fields[name];
    if (!f) return false;
    if (f.value === null) return ENTITY_FIELDS.includes(name) && ['absent', 'not_applicable'].includes(f.resolution) && f.evidence === 'none';
    return f.evidence === 'observed' && f.resolution === 'known' && f.sources?.length > 0 && (!ENTITY_FIELDS.includes(name) || Boolean(f.entity_id));
  });
  if (!grounded) reasons.push('not_fully_grounded');
  const simpleCandidate = Boolean(output.single_issue && output.ready_for_validation && knowledge.complete && grounded && !attention.length);
  if (!policy.simplified_review_enabled) reasons.push('simplification_suspended');
  return {
    policy_version: policy.version, policy_revision: policy.revision,
    action: !output.ready_for_validation ? 'clarify' : simpleCandidate && policy.simplified_review_enabled ? 'simple_confirmation' : 'detailed_review',
    simple_candidate: simpleCandidate, attention_fields: attention, reasons,
    human_confirmation_required: true, automatic_recording_allowed: false,
    autonomy_blockers: ['domain_evaluation_pending', 'supervised_pilot_pending', 'verified_reviewer_access_pending'],
  };
}

export async function loadReviewPolicy(client, signal) {
  const { data, error } = await client.rpc('current_review_policy').abortSignal(signal);
  if (error) throw new Error('review_policy_unavailable');
  return validateReviewPolicy(data);
}

const errorCodes = new Set(['knowledge_unavailable', 'review_policy_unavailable', 'invalid_provider_response', 'invalid_resolved_classification', 'request_timeout', 'analysis_session_failed']);
export function analysisEvent({ result, error, model, messages, elapsedMs }) {
  return {
    analysis_session_id: result?.analysis_id ?? null, model,
    prompt_version: result?.prompt_version ?? null,
    status: result ? 'succeeded' : 'failed',
    error_code: result ? null : errorCodes.has(error?.message) ? error.message : 'upstream_failure',
    action: result?.review_policy.action ?? null,
    policy_version: result?.review_policy.policy_version ?? null,
    policy_revision: result?.review_policy.policy_revision ?? null,
    simple_candidate: result?.review_policy.simple_candidate ?? false,
    attention_fields: result?.review_policy.attention_fields ?? [],
    reasons: result?.review_policy.reasons ?? [],
    category: result?.fields.categoria_problema.value ?? null,
    examples_version: result?.knowledge.examples_version ?? null,
    dictionary_sha256: result?.knowledge.dictionary_sha256 ?? null,
    user_turns: messages.filter(m => m.role === 'user').length,
    elapsed_ms: Math.max(0, Math.round(elapsedMs)),
  };
}
