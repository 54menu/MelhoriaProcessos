import { createHash } from "node:crypto";
import { classify, parseConversation } from "../supabase/functions/_shared/classification-pipeline.mjs";
import { invokeGemini, timed, PROMPT_VERSION, providerBody } from "../supabase/functions/_shared/classification-provider.mjs";
import { classificationSchema, taxonomy, CONTRACT_VERSION, FIELDS } from "./classification-contract.mjs";
import { selectContext, approvedExamples } from "../supabase/functions/_shared/knowledge-context.mjs";
import { evaluate } from "./classification-evaluation.mjs";

export const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function prepareComparison({ config, cases, datasetVersion, snapshot, catalog, implementationHash }) {
  if (!config || !["dev", "test"].includes(config.split) || !Number.isInteger(config.repetitions) || config.repetitions < 1 || config.repetitions > 5 || !Number.isInteger(config.max_calls) || config.max_calls < 1 || config.max_calls > 1000 || !Number.isInteger(config.case_timeout_ms) || config.case_timeout_ms < 100 || config.case_timeout_ms > 45000) throw new Error("invalid_comparison_config");
  if (![config.baseline, config.candidate].every(m => typeof m === "string" && /^gemini-[a-z0-9.-]+$/.test(m)) || config.baseline === config.candidate) throw new Error("invalid_comparison_models");
  if (!Array.isArray(snapshot?.entities) || !Array.isArray(snapshot.aliases) || snapshot.complete !== true || typeof snapshot.version !== "string" || !snapshot.version) throw new Error("invalid_dictionary_snapshot");
  const ids = new Set();
  for (const e of snapshot.entities) {
    if (!e || typeof e.id !== "string" || !e.id || ids.has(e.id) || !Object.hasOwn(taxonomy.entities,e.entity_type) || typeof e.canonical_name !== "string" || !e.canonical_name.trim() || !["homologated","candidate","rejected","consolidated"].includes(e.governance_status)) throw new Error("invalid_dictionary_entity");
    ids.add(e.id);
  }
  for (const a of snapshot.aliases) if (!a || typeof a.alias !== "string" || !a.alias.trim() || !snapshot.entities.some(e => e.id === a.entity_id && e.entity_type === a.entity_type)) throw new Error("invalid_dictionary_alias");
  if (snapshot.version === "none" && (snapshot.entities.length || snapshot.aliases.length)) throw new Error("nonempty_dictionary_none");
  if (!Array.isArray(cases) || !cases.length || new Set(cases.map(c=>c.id)).size !== cases.length || cases.some(c=>!c.id || !parseConversation(c.messages))) throw new Error("invalid_cases");
  // Even development cases cannot be fed their own answers as examples.
  const texts = new Set(cases.map(c=>hash(c.messages.filter(m=>m.role==='user').map(m=>m.text.trim()).join('\n'))));
  for (const e of approvedExamples(catalog)) if (texts.has(hash(e.text.trim()))) throw new Error("example_dataset_overlap");
  const selected = cases.filter(c=>c.split === config.split);
  if (!selected.length) throw new Error("empty_split");
  const maxRequests = selected.length * 2 * config.repetitions * 2;
  if (config.max_calls < maxRequests) throw new Error("call_budget_too_small");
  return { config, cases: selected, snapshot, catalog, metadata: {
    dataset_version: datasetVersion, dataset_sha256: hash(cases), contract_version: CONTRACT_VERSION, contract_sha256: hash(classificationSchema), taxonomy_version: taxonomy.version, taxonomy_sha256: hash(taxonomy), split: config.split,
    prompt_version: PROMPT_VERSION, prompt_sha256: hash(providerBody([], {entities:[],aliases:[],examples:[]})), dictionary_version: snapshot.version, dictionary_sha256: hash(snapshot), examples_sha256: hash(catalog), implementation_sha256: implementationHash,
    config_sha256: hash(config), max_provider_calls: maxRequests, semantic_retrieval: "disabled_for_both", cases: selected.length,
  } };
}

export async function runComparison(plan, { apiKey, fetchImpl = fetch, onProgress = async () => {}, now = () => new Date().toISOString() } = {}) {
  if (!apiKey) throw new Error("gemini_not_configured");
  const { config, cases, snapshot, catalog, metadata } = plan;
  const result = { status: "running", metadata, started_at: now(), runs: [] };
  const models = [config.baseline, config.candidate];
  for (let repetition=0; repetition<config.repetitions; repetition++) {
    const runs = models.map(model => ({ run: {...metadata, model, repetition: repetition+1, executed_at: now()}, entities: snapshot.entities, predictions: [] }));
    result.runs.push(...runs);
    for (let i=0; i<cases.length; i++) {
      const item=cases[i];
      // Alternate order to reduce bias from one model always running first.
      for (const run of ((i+repetition)%2 ? [...runs].reverse() : runs)) {
        const attempts=[]; const started=performance.now(); let output=null; let knowledge=null; let error=null;
        try {
          const response=await timed(signal=>classify(parseConversation(item.messages), {
            model:run.run.model, catalog, signal, persistSession:false,
            repository:{loadDictionary:async()=>structuredClone(snapshot),createSession:async()=>{throw new Error("evaluation_must_not_write");}},
            provider: input=>invokeGemini({...input,apiKey,model:run.run.model,fetchImpl,onAttempt:event=>attempts.push(event)}),
          }),config.case_timeout_ms);
          output=Object.fromEntries(Object.keys(classificationSchema.properties).map(key=>[key,response[key]])); knowledge=response.knowledge;
        } catch(e) {
          error=["invalid_provider_response","provider_unavailable","provider_rejected_request","request_timeout","provider_timeout_or_network","invalid_resolved_classification"].includes(e.message) ? e.message : "evaluation_failed";
        }
        run.predictions.push({case_id:item.id,output,knowledge,error,latency_ms:performance.now()-started,attempts, cost_usd:null});
        await onProgress(structuredClone(result));
      }
    }
  }
  result.status="completed_pending_review"; result.finished_at=now(); return result;
}

export function summarizeComparison(plan, result) {
  if (result.metadata.config_sha256 !== plan.metadata.config_sha256 || result.metadata.dataset_sha256 !== plan.metadata.dataset_sha256 || result.metadata.implementation_sha256 !== plan.metadata.implementation_sha256) throw new Error("incompatible_comparison");
  const reports=result.runs.map(run=>({model:run.run.model,repetition:run.run.repetition,...evaluate(plan.cases,run.predictions,{entities:plan.snapshot.entities}), failed_calls:run.predictions.filter(p=>p.error).length,
    provider_attempts:run.predictions.reduce((sum,p)=>sum+p.attempts.length,0),
    usage_complete:run.predictions.length===plan.cases.length && run.predictions.every(p=>p.attempts.length && p.attempts.every(a=>a.usage)),
  }));
  const pairs=[];
  for(let r=1;r<=plan.config.repetitions;r++) {
    const left=result.runs.find(x=>x.run.model===plan.config.baseline&&x.run.repetition===r);
    const right=result.runs.find(x=>x.run.model===plan.config.candidate&&x.run.repetition===r);
    for(const c of plan.cases) {
      const a=left?.predictions.find(p=>p.case_id===c.id)?.output; const b=right?.predictions.find(p=>p.case_id===c.id)?.output;
      pairs.push({case_id:c.id,repetition:r,missing:!a||!b,readiness_disagrees:a&&b?a.ready_for_validation!==b.ready_for_validation:null,fields_disagree:a&&b?FIELDS.filter(f=>a.fields[f].value!==b.fields[f].value):null});
    }
  }
  return {status:result.status,metadata:plan.metadata,result_sha256:hash(result),reports,pairs,
    decision:{selected_model:null,production_change:false,reasons:["domain_labels_require_review","semantic_outputs_require_human_review","supervised_pilot_pending","cost_and_human_effort_pending" ]},
    limitations:["Base sintética proposta: não certifica acurácia operacional.","Sem recuperação por embeddings; ambos usam o mesmo snapshot e busca lexical.","Latência por análise, não por conversa concluída. Custos permanecem nulos sem medição financeira.","Modelos com configuração padrão de raciocínio; versões retornadas e consumo ficam nas tentativas."]};
}

export function reviewTemplate(plan, result) {
  return {result_sha256:hash(result), reviewed_by:null, reviewed_at:null, cases:result.runs.flatMap(run=>run.predictions.map(p=>({case_id:p.case_id,model:run.run.model,repetition:run.run.repetition,messages:plan.cases.find(c=>c.id===p.case_id).messages,output:p.output,semantic_fabrication:null,question_useful:null,correction_needed:null,review_seconds:null,notes:""})))};
}
