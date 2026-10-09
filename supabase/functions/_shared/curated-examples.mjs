import { approvedExamples } from './knowledge-context.mjs';
import { CONTRACT_VERSION, taxonomy, classificationSchema } from './classification-contract.mjs';
import { PROMPT_VERSION } from './classification-provider.mjs';

export async function jsonHash(value) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export async function loadCuratedExamples(client,signal) {
  const {data,error}=await client.rpc('curated_example_catalog',{p_include_approved:false}).abortSignal(signal);
  if(error || !data || typeof data.version!=='string' || !Array.isArray(data.examples) || data.examples.length>500) {
    console.error('curated_catalog_unavailable',error?.code??'invalid_catalog_shape');
    throw new Error('knowledge_unavailable');
  }
  if(approvedExamples(data).length!==data.examples.length) throw new Error('knowledge_unavailable');
  return data;
}

// Validate paired regression evidence. Human semantic review is declared by the
// curator; this POC does not authenticate that identity or sign model runs.
export async function assessRegression(report,snapshot,expectedModel) {
  const fail=()=>{throw new Error('invalid_regression');};
  const a=report?.baseline,b=report?.candidate,h=report?.human_review;
  if(!a||!b||!h||typeof h.reviewed_by!=='string'||!h.reviewed_by.trim()||!Number.isFinite(Date.parse(h.reviewed_at))||h.no_fabrications!==true||h.no_semantic_regressions!==true||typeof h.reference!=='string'||!h.reference.trim()||h.reference.length>1000) fail();
  if(!Number.isInteger(b.total_cases)||b.total_cases<1||b.total_cases!==a.total_cases||b.human_reviewed_cases!==b.total_cases||a.human_reviewed_cases!==a.total_cases||b.missing!==0||a.missing!==0) fail();
  const keys=['dataset_sha256','contract_sha256','taxonomy_sha256','split','model','prompt_version','dictionary_sha256'];
  if(!a.run||!b.run||keys.some(k=>!a.run[k]||a.run[k]!==b.run[k])||b.run.contract_version!==CONTRACT_VERSION||b.run.taxonomy_version!==taxonomy.version) fail();
  if(b.run.contract_sha256!==await jsonHash(classificationSchema)||b.run.taxonomy_sha256!==await jsonHash(taxonomy)||b.run.prompt_version!==PROMPT_VERSION||(expectedModel&&b.run.model!==expectedModel)) fail();
  if(snapshot.dictionary&&b.run.dictionary_sha256!==await jsonHash(snapshot.dictionary)) fail();
  if(b.run.examples_sha256!==await jsonHash(snapshot.candidate)||a.run.examples_sha256!==await jsonHash(snapshot.baseline)) fail();
  if(b.contract?.valid!==b.total_cases||b.contract?.total!==b.total_cases||!Array.isArray(a.details)||!Array.isArray(b.details)||a.details.length!==a.total_cases||b.details.length!==b.total_cases) fail();
  const previous=new Map(a.details.map(d=>[d.case_id,d]));
  if(previous.size!==a.total_cases||new Set(b.details.map(d=>d.case_id)).size!==b.total_cases) fail();
  for(const row of b.details) {
    const old=previous.get(row.case_id);
    if(!old||row.valid!==true||!Array.isArray(row.mismatched_fields)||!Array.isArray(old.mismatched_fields)||typeof row.readiness_correct!=='boolean'||typeof old.readiness_correct!=='boolean'||typeof row.single_issue_correct!=='boolean'||typeof old.single_issue_correct!=='boolean') fail();
    if(row.mismatched_fields.some(f=>!old.mismatched_fields.includes(f))||(old.readiness_correct&&!row.readiness_correct)||(old.single_issue_correct&&!row.single_issue_correct)) fail();
  }
  for(const name of Object.keys(taxonomy.entities).concat(['tipo','categoria_problema'])) {
    const x=a.fields?.[name],y=b.fields?.[name];
    if(!x||!y||!Number.isInteger(x.total)||x.total<0||x.total!==y.total||!Number.isInteger(x.correct)||!Number.isInteger(y.correct)||x.correct<0||y.correct<x.correct||y.correct>y.total) fail();
    if(['tipo','categoria_problema'].includes(name)&&y.total!==b.total_cases) fail();
  }
  if(!Number.isInteger(b.premature_reviews)||b.premature_reviews!==0||!Number.isInteger(a.unnecessary_questions)||!Number.isInteger(b.unnecessary_questions)||b.unnecessary_questions>a.unnecessary_questions) fail();
  return {status:'passed',candidate_fingerprint:snapshot.candidate_fingerprint,report_sha256:await jsonHash(report),reference:h.reference,reviewed_by:h.reviewed_by,reviewed_at:h.reviewed_at,dataset_sha256:b.run.dataset_sha256,model:b.run.model,prompt_version:b.run.prompt_version,cases:b.total_cases,verification:'curator_declared_with_machine_checked_metrics'};
}

export function createCurationHandler(repository) {
  const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json; charset=utf-8'};
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
  const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=max;
  return async request=>{
    if(request.method==='OPTIONS') return new Response(null,{status:204,headers});
    if(request.method!=='POST') return reply(405,{error:{message:'Use POST.'}});
    const p=await request.json().catch(()=>null);
    if(!p||typeof p!=='object') return reply(400,{error:{message:'Solicitação inválida.'}});
    try {
      if(p.operation==='list') {
        if(!['pending','approved','active','rejected','retired'].includes(p.status)||!Number.isInteger(p.offset)||p.offset<0||p.offset>100000) throw new Error('invalid_request');
        return reply(200,await repository.list(p.status,p.offset));
      }
      if(p.operation==='export') return reply(200,await repository.snapshot());
      if(!text(p.actor,120)) throw new Error('invalid_request');
      if(p.operation==='publish') {
        const snapshot=await repository.snapshot();
        const regression=await assessRegression(p.report,snapshot,repository.model);
        const revision=await repository.publish({p_base_revision:snapshot.base_revision,p_fingerprint:snapshot.candidate_fingerprint,p_actor:p.actor.trim(),p_regression:regression});
        return reply(200,{revision});
      }
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.id)||!text(p.note,1000)) throw new Error('invalid_request');
      if(p.operation==='retire') {await repository.retire({p_id:p.id,p_actor:p.actor.trim(),p_note:p.note.trim()});return reply(200,{status:'retired'});}
      if(p.operation!=='review'||typeof p.approved!=='boolean') throw new Error('invalid_request');
      if(p.approved) {
        if(!text(p.text,2000)||!p.classification||Object.keys(p.classification).length!==6) throw new Error('invalid_request');
        approvedExamples({examples:[{id:p.id,status:'approved',text:p.text,classification:p.classification,taxonomy_version:taxonomy.version,reviewed_by:p.actor,reviewed_at:new Date().toISOString()}]});
      }
      await repository.review({p_id:p.id,p_approved:p.approved,p_text:p.approved?p.text.trim():null,p_classification:p.approved?p.classification:null,p_actor:p.actor.trim(),p_note:p.note.trim()});
      return reply(200,{status:p.approved?'approved':'rejected'});
    } catch(e) {
      const invalid=['invalid_request','invalid_regression','invalid_approved_example','invalid_example_classification'].includes(e.message);
      return reply(invalid?400:409,{error:{message:invalid?'Confira os campos e o relatório: é necessário avaliar a mesma base revisada, sem novas regressões, e declarar a revisão semântica.':'Não foi possível concluir. Atualize a lista; a proposta ou o catálogo podem ter mudado.'}});
    }
  };
}
