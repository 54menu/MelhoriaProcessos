import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { prepareComparison, runComparison, summarizeComparison, reviewTemplate } from '../lib/model-comparison.mjs';
import { invokeGemini } from '../supabase/functions/_shared/classification-provider.mjs';
import { FIELDS, taxonomy, CONTRACT_VERSION } from '../lib/classification-contract.mjs';

const messages=[{role:'user',text:'O Portal fecha ao salvar.'}];
const cases=[{id:'sample',split:'dev',messages,review_status:'pending_domain_review',expected:{fields:{tipo:['reclamacao'],categoria_problema:['erro'],sistema:['Portal']},ready_for_validation:true,single_issue:true}}];
const config={baseline:'gemini-baseline',candidate:'gemini-candidate',split:'dev',repetitions:1,max_calls:4,case_timeout_ms:5000};
const snapshot={version:'none',entities:[],aliases:[],complete:true};
const catalog={version:'test',examples:[]};
const makePlan=(changes={})=>prepareComparison({config,cases,snapshot,catalog,datasetVersion:'fixture',implementationHash:'fixture',...changes});
function output(){
  const fields=Object.fromEntries(FIELDS.map(f=>[f,{value:null,entity_id:null,evidence:'none',sources:[],resolution:'absent',pending_reason:null,confidence:null}]));
  for(const [f,value] of [['tipo','reclamacao'],['categoria_problema','erro'],['sistema','Portal']]) fields[f]={value,entity_id:null,evidence:'observed',sources:[{message_index:0,quote:messages[0].text}],resolution:f==='sistema'?'unresolved':'known',pending_reason:f==='sistema'?'Resolução pendente':null,confidence:0.8};
  return {contract_version:CONTRACT_VERSION,taxonomy_version:taxonomy.version,fields,single_issue:true,ready_for_validation:true,summary:messages[0].text,assistant_message:'Confira.',clarification_question:null,confirmation_required:true};
}
const response=()=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output())}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:50,thoughtsTokenCount:10,totalTokenCount:160},modelVersion:'fixture-version'}));
test('D: comparação usa mesmas entradas sem gabaritos, não cria sessão e mantém metadados',async()=>{
  const bodies=[]; const plan=makePlan();
  const result=await runComparison(plan,{apiKey:'secret-test',fetchImpl:async(url,init)=>{bodies.push(init.body);return response();}});
  assert.equal(result.runs.length,2); assert.equal(bodies[0],bodies[1]); assert.doesNotMatch(bodies[0],/expected|rationale|review_status/);
  const p=result.runs[0].predictions[0]; assert.equal(p.output.fields.sistema.resolution,'new'); assert.equal(p.output.analysis_id,undefined);
  assert.equal(p.attempts[0].usage.totalTokenCount,160); assert.equal(p.attempts[0].model_version,'fixture-version');
  const report=summarizeComparison(plan,result); assert.equal(report.reports[0].contract.rate,1); assert.equal(report.decision.selected_model,null); assert.equal(report.reports[0].cost_usd,null);
  const review=reviewTemplate(plan,result); assert.equal(review.cases[0].semantic_fabrication,null); assert.equal(review.result_sha256,report.result_sha256);
  assert.doesNotMatch(JSON.stringify(result),/secret-test/);
});
test('D: falha de um modelo é contabilizada e não impede avaliação do outro',async()=>{
  const plan=makePlan(); const result=await runComparison(plan,{apiKey:'key',fetchImpl:async(url)=>url.includes('candidate')?new Response('',{status:400}):response()});
  const report=summarizeComparison(plan,result); assert.equal(report.reports[1].failed_calls,1); assert.equal(report.reports[1].contract.rate,0); assert.equal(report.pairs[0].missing,true);
});
test('D: registra consumo de tentativas inválidas antes da correção',async()=>{
  let calls=0; const attempts=[];
  await invokeGemini({messages,context:{},apiKey:'key',model:'test',sleep:async()=>{},onAttempt:e=>attempts.push(e),fetchImpl:async()=>{calls++;return calls===1?new Response(JSON.stringify({candidates:[],usageMetadata:{totalTokenCount:30}})):response();}});
  assert.equal(attempts.length,2); assert.equal(attempts[0].usage.totalTokenCount,30); assert.equal(attempts[1].usage.totalTokenCount,160);
});
test('D: recusa orçamento insuficiente, snapshot parcial, modelos iguais e contaminação por exemplos',()=>{
  assert.throws(()=>makePlan({config:{...config,max_calls:3}}),/budget/);
  assert.throws(()=>makePlan({snapshot:{...snapshot,complete:false}}),/snapshot/);
  assert.throws(()=>makePlan({config:{...config,candidate:config.baseline}}),/models/);
  const example={id:'copy',status:'approved',reviewed_by:'fixture',reviewed_at:'2026-10-09',taxonomy_version:taxonomy.version,text:messages[0].text,classification:Object.fromEntries(FIELDS.map(f=>[f,output().fields[f].value]))};
  assert.throws(()=>makePlan({catalog:{...catalog,examples:[example]}}),/overlap/);
});
test('D: ausência de credencial não dispara rede; plano CLI não chama modelos',async()=>{
  await assert.rejects(runComparison(makePlan(),{fetchImpl:()=>{throw new Error('network');}}),/not_configured/);
  const plan=JSON.parse(execFileSync(process.execPath,['scripts/compare-models.mjs'],{encoding:'utf8'}));
  assert.equal(plan.status,'dry_run_no_api_calls'); assert.equal(plan.cases,20); assert.equal(plan.max_provider_calls,80);
});
test('D: modelos separados por finalidade preservam configuração anterior',async()=>{
  const a=await readFile(new URL('../supabase/functions/analyze-perception/index.ts',import.meta.url),'utf8');
  const e=await readFile(new URL('../supabase/functions/knowledge-evolution/index.ts',import.meta.url),'utf8');
  assert.match(a,/CLASSIFICATION_MODEL.*GEMINI_MODEL/);assert.match(e,/EVOLUTION_MODEL.*GEMINI_MODEL/);
});
