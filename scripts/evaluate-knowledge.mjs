import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
import { referenceCases,datasetVersion } from '../evals/reference-cases.mjs';
import { classify,parseConversation } from '../supabase/functions/_shared/classification-pipeline.mjs';
import { invokeGemini,timed,PROMPT_VERSION } from '../supabase/functions/_shared/classification-provider.mjs';
import { classificationSchema,taxonomy,CONTRACT_VERSION } from '../lib/classification-contract.mjs';
import { approvedExamples,normalize } from '../supabase/functions/_shared/knowledge-context.mjs';
import { jsonHash } from '../supabase/functions/_shared/curated-examples.mjs';
import { evaluate } from '../lib/classification-evaluation.mjs';
const args={};
for(let i=2;i<process.argv.length;i++) {
  const k=process.argv[i];if(k==='--execute'){args.execute=true;continue;}
  if(!['--snapshot','--dataset','--dictionary','--split','--model','--output-dir','--relay-config'].includes(k)||!process.argv[i+1]||args[k]) throw new Error('Argumentos inválidos');args[k]=process.argv[++i];
}
const read=async path=>JSON.parse(await readFile(path,'utf8'));
async function main(){
  if(!args['--snapshot']) throw new Error('Informe --snapshot com o catálogo exportado na tela de curadoria.');
  const snapshot=await read(args['--snapshot']);
  if(!snapshot.baseline||!snapshot.candidate||!Number.isInteger(snapshot.base_revision)||!/^[a-f0-9]{32}$/.test(snapshot.candidate_fingerprint)) throw new Error('Snapshot inválido');
  approvedExamples(snapshot.baseline);approvedExamples(snapshot.candidate);
  const dataset=args['--dataset']?await read(args['--dataset']):{version:datasetVersion,cases:referenceCases};
  const dictionary=args['--dictionary']?await read(args['--dictionary']):snapshot.dictionary??{version:'none',entities:[],aliases:[],complete:true};
  if(dictionary.complete!==true||!Array.isArray(dictionary.entities)||!Array.isArray(dictionary.aliases))throw new Error('Dicionário completo obrigatório');
  const split=args['--split']||'dev';if(!['dev','test'].includes(split))throw new Error('Split inválido');
  const cases=dataset.cases.filter(c=>c.split===split);
  if(!cases.length||cases.length>100||new Set(cases.map(c=>c.id)).size!==cases.length||cases.some(c=>!parseConversation(c.messages)||!c.expected))throw new Error('Base inválida (máximo 100 casos por execução)');
  for(const c of cases)if(c.review_status==='approved'&&(!c.reviewed_by?.trim()||!Number.isFinite(Date.parse(c.reviewed_at))))throw new Error('Gabarito aprovado exige responsável e data');
  const heldOut=new Set(dataset.cases.map(c=>normalize(c.messages.filter(m=>m.role==='user').map(m=>m.text).join('\n'))));
  if(snapshot.candidate.examples.some(e=>heldOut.has(normalize(e.text))))throw new Error('Exemplo de treinamento sobreposto à avaliação');
  const model=args['--model']||process.env.CLASSIFICATION_MODEL||process.env.GEMINI_MODEL||'gemini-3.5-flash-lite';
  if(!/^gemini-[a-z0-9.-]+$/.test(model))throw new Error('Modelo inválido');
  const metadata={dataset_version:dataset.version,dataset_sha256:await jsonHash(dataset.cases),contract_version:CONTRACT_VERSION,contract_sha256:await jsonHash(classificationSchema),taxonomy_version:taxonomy.version,taxonomy_sha256:await jsonHash(taxonomy),split,model,prompt_version:PROMPT_VERSION,dictionary_version:dictionary.version,dictionary_sha256:await jsonHash(dictionary),executed_at:new Date().toISOString()};
  if(!args.execute){console.log(JSON.stringify({status:'dry_run_no_api_calls',cases:cases.length,max_calls:cases.length*4,model,base_revision:snapshot.base_revision},null,2));return;}
  let apiKey=process.env.GEMINI_API_KEY,fetchImpl=fetch;
  if(args['--relay-config']){
    const relay=await read(args['--relay-config']);const url=new URL(relay.url);
    if(url.protocol!=='https:'||!url.hostname.endsWith('.supabase.co')||!relay.token||!relay.anonKey)throw new Error('Transporte de avaliação inválido');
    apiKey='server_managed';fetchImpl=async(providerUrl,init)=>fetch(relay.url,{method:'POST',signal:init.signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${relay.anonKey}`,'x-evaluation-token':relay.token},body:JSON.stringify({model:decodeURIComponent(new URL(providerUrl).pathname.split('/').at(-1).replace(':generateContent','')),body:JSON.parse(init.body)})});
  }
  if(!apiKey)throw new Error('Use GEMINI_API_KEY no ambiente ou --relay-config para credencial mantida no Supabase. Não envie a chave na conversa.');
  const dir=resolve(args['--output-dir']||`.test-artifacts/knowledge-${Date.now()}`);await mkdir(dirname(dir),{recursive:true});await mkdir(dir,{recursive:false});
  const save=(name,data)=>writeFile(resolve(dir,name),JSON.stringify(data,null,2)+'\n');
  const runs={baseline:{run:{...metadata,examples_sha256:await jsonHash(snapshot.baseline)},predictions:[]},candidate:{run:{...metadata,examples_sha256:await jsonHash(snapshot.candidate)},predictions:[]}};
  await save('snapshot.json',snapshot);
  for(let i=0;i<cases.length;i++) for(const side of (i%2?['candidate','baseline']:['baseline','candidate'])){
    const c=cases[i],started=performance.now(),attempts=[];let output=null;
    try{const data=await timed(signal=>classify(parseConversation(c.messages),{signal,persistSession:false,model,catalog:snapshot[side],repository:{loadDictionary:async()=>dictionary},provider:input=>invokeGemini({...input,model,apiKey,fetchImpl,onAttempt:e=>attempts.push(e)})}),45000);
      output=Object.fromEntries(Object.keys(classificationSchema.properties).map(k=>[k,data[k]]));
    }catch{ /* Failed calls remain in the denominator and in the checkpoint. */ }
    runs[side].predictions.push({case_id:c.id,output,latency_ms:performance.now()-started,attempts,cost_usd:null});await save('checkpoint.json',runs);
    console.log(`${side}: ${i+1}/${cases.length}`);
  }
  const report={baseline:{run:runs.baseline.run,...evaluate(cases,runs.baseline.predictions,{entities:dictionary.entities})},candidate:{run:runs.candidate.run,...evaluate(cases,runs.candidate.predictions,{entities:dictionary.entities})},human_review:{reviewed_by:null,reviewed_at:null,no_fabrications:null,no_semantic_regressions:null,reference:null}};
  await save('responses.json',runs);await save('regression-report.json',report);
  console.log(`Relatório em ${dir}. Revise as respostas e preencha human_review; não há publicação automática.`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
