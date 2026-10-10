import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { referenceCases, datasetVersion } from "../evals/reference-cases.mjs";
import { exampleCatalog } from "../supabase/functions/_shared/examples.generated.mjs";
import { prepareComparison, runComparison, summarizeComparison, reviewTemplate, hash } from "../lib/model-comparison.mjs";

const options={};
for(let i=2;i<process.argv.length;i++) {
  const key=process.argv[i];
  if(key==='--execute') {options.execute=true;continue;}
  if(!['--config','--dictionary','--dataset','--catalog','--output-dir','--relay-config'].includes(key)||!process.argv[i+1]||options[key]) throw new Error('Argumentos inválidos');
  options[key]=process.argv[++i];
}
const json=async path=>JSON.parse(await readFile(path,'utf8'));
async function main() {
  const config=await json(options['--config']||'evals/model-comparison.config.json');
  const snapshot=await json(options['--dictionary']||'evals/dictionary.empty.json');
  const dataset=options['--dataset']?await json(options['--dataset']):{version:datasetVersion,cases:referenceCases};
  const catalog=options['--catalog']?await json(options['--catalog']):exampleCatalog;
  const sources=await Promise.all(['classification-pipeline.mjs','classification-provider.mjs','knowledge-context.mjs','classification-contract.mjs','selective-review.mjs'].map(f=>readFile(new URL('../supabase/functions/_shared/'+f,import.meta.url),'utf8')));
  const plan=prepareComparison({config,cases:dataset.cases,datasetVersion:dataset.version,snapshot,catalog,implementationHash:hash(sources)});
  const reviewed=plan.cases.filter(c=>c.review_status==='approved'&&typeof c.reviewed_by==='string'&&c.reviewed_by.trim()&&Number.isFinite(Date.parse(c.reviewed_at))).length;
  if(!options.execute) {console.log(JSON.stringify({status:'dry_run_no_api_calls',...plan.metadata,reviewed_cases:reviewed,external_dataset:!!options['--dataset'],models:[config.baseline,config.candidate]},null,2));return;}
  if(options['--dataset']&&reviewed!==plan.cases.length) throw new Error('Base externa exige gabaritos aprovados, responsável e data antes da execução.');
  let apiKey=process.env.GEMINI_API_KEY; let fetchImpl=fetch;
  if(options['--relay-config']) {
    const relay=await json(options['--relay-config']);
    const url=new URL(relay.url);
    if(url.protocol!=='https:'||!url.hostname.endsWith('.supabase.co')||!relay.token||!relay.anonKey) throw new Error('invalid_relay');
    apiKey='server_managed';
    fetchImpl=async (providerUrl, init)=>{
      const model=decodeURIComponent(new URL(providerUrl).pathname.split('/').at(-1).replace(':generateContent',''));
      return fetch(relay.url,{method:'POST',signal:init.signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${relay.anonKey}`,'x-evaluation-token':relay.token},body:JSON.stringify({model,body:JSON.parse(init.body)})});
    };
  }
  if(!apiKey) throw new Error('GEMINI_API_KEY ausente. Configure no ambiente; não envie a chave na conversa.');
  const dir=resolve(options['--output-dir']||`.test-artifacts/comparison-${Date.now()}`);
  // Never overwrite an earlier experiment.
  await mkdir(dir,{recursive:false});
  const save=(file,data)=>writeFile(resolve(dir,file),JSON.stringify(data,null,2)+'\n');
  await save('plan.json',{metadata:plan.metadata,config,snapshot,catalog,cases:plan.cases});
  const result=await runComparison(plan,{apiKey,fetchImpl,onProgress:async result=>{
    await save('checkpoint.json',result);
    console.log(`Análises concluídas: ${result.runs.reduce((n,r)=>n+r.predictions.length,0)}/${plan.cases.length*2*config.repetitions}`);
  }});
  await save('result.json',result); await save('report.json',summarizeComparison(plan,result)); await save('human-review.json',reviewTemplate(plan,result));
  for(const run of result.runs) await save(`${run.run.model}-${run.run.repetition}.json`,run);
  console.log(`Comparação salva em ${dir}. Seleção e piloto dependem de revisão humana.`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
