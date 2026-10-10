import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { parseHTML } from "linkedom";
import { createReview } from "../js/review.mjs";
import { parseConfirmation, createRecordHandler } from "../supabase/functions/_shared/review-confirmation.mjs";
import { assessRegression, jsonHash, loadCuratedExamples, createCurationHandler } from '../supabase/functions/_shared/curated-examples.mjs';
import { selectContext } from '../supabase/functions/_shared/knowledge-context.mjs';
import { curationCard } from '../js/curation-card.mjs';
import { classificationSchema,taxonomy } from '../lib/classification-contract.mjs';
import { PROMPT_VERSION } from '../supabase/functions/_shared/classification-provider.mjs';
import { createMonitoringHandler } from '../supabase/functions/_shared/classification-monitoring.mjs';
import { renderMonitoring } from '../js/monitoring-report.mjs';

const classification = { tipo: "reclamacao", processo: null, subprocesso: null, sistema: "Portal", produto: null, categoria_problema: "erro" };
const fields = Object.fromEntries(Object.entries(classification).map(([k,value]) => [k, { value, evidence: value ? "inferred" : "none", resolution: value ? "unresolved" : "absent", sources: value ? [{ message_index: 0, quote: "Portal falhou" }] : [] }]));
const proposal = { interpretation: "Proposta original", fields, contract_version: "classification.1", taxonomy_version: "taxonomy.1", knowledge: { dictionary_complete: true } };
let db;
const migrationFiles = (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(f => f.endsWith('.sql') && !f.includes('_semantic')).sort();
async function setup(files = migrationFiles) {
  const instance = new PGlite();
  await instance.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;');
  for (const file of files) await instance.exec(await readFile(new URL('../supabase/migrations/'+file, import.meta.url), 'utf8'));
  return instance;
}
before(async () => { db = await setup(); });
after(async () => { await db?.close(); });
beforeEach(async () => { await db.exec('reset role; truncate public.perceptions, public.analysis_sessions, public.entities cascade;'); });
async function session() {
  return (await db.query("insert into analysis_sessions(original_text,prompt_version,model,raw_response,proposed_interpretation) values('Portal falhou','prompt.test','model.test','{}',$1) returning id", [proposal])).rows[0].id;
}
async function persist(id, values = classification, summary = 'Resumo final') {
  return (await db.query('select persist_reviewed_perception($1,$2,$3,$4) as id', [id, values, summary, 'Revisor teste'])).rows[0].id;
}
async function entity(name, status = 'homologated') {
  return (await db.query("insert into entities(entity_type,canonical_name,normalized_name,governance_status) values('sistema',$1,normalize_entity_name($1),$2) returning id", [name,status])).rows[0].id;
}
async function alias(id, name) {
  await db.query("insert into entity_aliases(entity_id,entity_type,alias,normalized_alias) values($1,'sistema',$2,normalize_entity_name($2))", [id,name]);
}
async function analytics() { return (await db.query('select canonical_operational_analytics() as data')).rows[0].data; }

test('F: política administrativa é versionada, reversível e não concede execução pública',async()=>{
  await db.exec('set role service_role');
  const initial=(await db.query('select current_review_policy() as p')).rows[0].p;
  const suspended=(await db.query("select set_review_simplification(false,'Teste','Investigar ajustes') as p")).rows[0].p;
  assert.equal(suspended.simplified_review_enabled,false);assert.ok(suspended.revision>initial.revision);
  const resumed=(await db.query("select set_review_simplification(true,'Teste','Revisão concluída') as p")).rows[0].p;
  assert.equal(resumed.simplified_review_enabled,true);assert.ok(resumed.revision>suspended.revision);
  for(const role of ['anon','authenticated']){
    await db.exec(`reset role;set role ${role}`);
    await assert.rejects(db.query('select current_review_policy()'),/permission denied/);
    await assert.rejects(db.query("select set_review_simplification(true,'X','X')"),/permission denied/);
    await assert.rejects(db.query('select * from classification_analysis_events'),/permission denied/);
    await assert.rejects(db.query('select classification_monitoring(30)'),/permission denied/);
  }
});

async function event(id,action='simple_confirmation',status='succeeded'){
  await db.query(`insert into classification_analysis_events(analysis_session_id,model,prompt_version,status,error_code,action,policy_revision,policy_version,simple_candidate,category,examples_version,user_turns,elapsed_ms)
    values($1,'fixture','prompt.test',$3,case when $3='failed' then 'request_timeout' else null end,$2,1,'selective-review.1',coalesce($2='simple_confirmation',false),'erro','curated.0',2,100)`,[id,action,status]);
}
async function monitoring(){return (await db.query('select classification_monitoring(30) as report')).rows[0].report;}

test('F: monitor separa tentativas, falhas e correções com denominadores e sem texto dos relatos',async()=>{
  const clean=await session(),corrected=await session();
  await event(clean);await event(corrected,'detailed_review');await event(null,'clarify');await event(null,null,'failed');
  await persist(clean,classification,proposal.interpretation);await persist(clean,classification,proposal.interpretation);
  await persist(corrected,{...classification,categoria_problema:'lentidao'},proposal.interpretation);
  await db.exec('set role service_role');const report=await monitoring();
  assert.equal(report.totals.attempts,4);assert.equal(report.totals.failures,1);assert.equal(report.totals.confirmed,2);assert.equal(report.totals.corrected,1);
  assert.equal(report.totals.clarification_requests,1);assert.equal(report.totals.average_turns_confirmed,2);
  assert.deepEqual(report.field_corrections,[{field:'categoria_problema',corrections:1}]);assert.equal(report.cost,null);
  assert.equal(report.automatic_recording_allowed,false);assert.equal(JSON.stringify(report).includes('Portal falhou'),false);
  assert.equal(report.alerts.correction_rate_exceeded,false);
  await assert.rejects(db.query('select classification_monitoring(10000)'),/invalid_monitoring_window/);
});

test('F: monitor vazio não inventa taxas e alertas respeitam amostra mínima',async()=>{
  const empty=await monitoring();assert.equal(empty.totals.attempts,0);assert.equal(empty.totals.average_turns_confirmed,null);
  for(let i=0;i<19;i++)await event(null,null,'failed');assert.equal((await monitoring()).alerts.failure_rate_exceeded,false);
  await event(null,null,'failed');assert.equal((await monitoring()).alerts.failure_rate_exceeded,true);
  await db.exec("update classification_analysis_events set created_at=now()-interval '91 days'");
  assert.equal((await monitoring()).totals.attempts,0);
});

test('F: endpoint é somente leitura, valida janela e trata indisponibilidade',async()=>{
  const handler=createMonitoringHandler(async days=>({days}));const request=body=>new Request('http://local',{method:'POST',body:JSON.stringify(body)});
  assert.equal((await handler(request({days:7}))).status,200);
  assert.equal((await handler(request({days:7,operation:'enable'}))).status,400);
  assert.equal((await handler(request({days:0}))).status,400);
  assert.equal((await handler(new Request('http://local'))).status,405);
  assert.equal((await createMonitoringHandler(async()=>{throw new Error('private');})(request({}))).status,503);
});

test('F: revisão simplificada mantém todos os campos editáveis e confirmação explícita',async()=>{
  const {document,window}=parseHTML('<html><body></body></html>');let calls=0;
  const data={summary:'Resumo',fields,review_policy:{action:'simple_confirmation',reasons:[],attention_fields:[]}};
  const card=createReview({document,data,onConfirm:async()=>{calls++;},onCancel(){}});document.body.append(card);
  assert.match(card.textContent,/Confira e confirme/);assert.equal(card.querySelectorAll('.review-support').length,6);
  assert.equal(card.querySelectorAll('input,select,textarea').length,8);assert.equal(calls,0);
  card.querySelector('[name=reviewer_label]').value='Pessoa';card.querySelector('form').dispatchEvent(new window.Event('submit',{cancelable:true}));await new Promise(r=>setImmediate(r));assert.equal(calls,1);
});

test('F: painel mostra denominadores vazios e escapa campos recebidos',async()=>{
  const {document}=parseHTML('<html><body><div id="report"></div></body></html>');const target=document.querySelector('#report');
  const report=await monitoring();report.groups=[{model:'<img src=x>',attempts:1,failures:1,confirmed:0,corrected:0}];
  renderMonitoring(document,target,report);assert.match(target.textContent,/Sem amostra/);assert.match(target.textContent,/Registro automático desativado/);assert.equal(target.querySelector('img'),null);
});

test('C: grava revisão, mantém original e proposta, resolve alias e preserva versões', async () => {
  const canonical = await entity('Portal Corporativo'); await alias(canonical, 'Portal');
  const id = await session(); await db.exec('set role service_role'); const perception = await persist(id);
  const row = (await db.query('select * from perception_reviews where perception_id=$1',[perception])).rows[0];
  assert.equal(row.final_summary,'Resumo final'); assert.equal(row.proposed_summary,'Proposta original');
  assert.equal(row.reviewer_verification,'self_declared'); assert.equal(row.provenance.model,'model.test');
  assert.equal(row.provenance.contract_version,'classification.1');
  assert.deepEqual(row.changes.summary,{before:'Proposta original',after:'Resumo final'});
  assert.equal(row.entity_snapshot.sistema.original_value,'Portal'); assert.equal(row.entity_snapshot.sistema.entity_id,canonical);
  assert.equal((await db.query('select original_text from perceptions')).rows[0].original_text,'Portal falhou');
  assert.equal((await db.query('select interpretation from ai_interpretations')).rows[0].interpretation,'Proposta original');
  assert.equal((await db.query('select sistema_entity_id from classifications')).rows[0].sistema_entity_id,canonical);
});
test('C: reenvio idêntico é idempotente; alteração após confirmação é rejeitada', async () => {
  const id=await session(); const first=await persist(id); assert.equal(await persist(id),first);
  await assert.rejects(persist(id,classification,'Outro resumo'),/analysis_session_unavailable/);
  assert.equal((await db.query('select count(*)::int as n from perceptions')).rows[0].n,1);
});
test('C: correção humana cria candidato sem homologação e registra evidência observada', async () => {
  await persist(await session(),{...classification,sistema:'Sistema Novo',produto:'Produto Novo'});
  assert.equal((await db.query("select governance_status from entities where canonical_name='Sistema Novo'")).rows[0].governance_status,'candidate');
  assert.equal((await db.query("select evidence_state from entity_evidence where field_name='sistema'")).rows[0].evidence_state,'observed');
  const review=(await db.query('select changes from perception_reviews')).rows[0]; assert.equal(review.changes.sistema.after,'Sistema Novo');
});
test('C: confirmação inválida e sessão expirada não gravam parcialmente', async () => {
  const id=await session();
  for (const c of [{...classification,tipo:null},{...classification,sistema:9},{...classification,entity_id:'fake'}]) await assert.rejects(persist(id,c),/invalid_confirmation/);
  await assert.rejects(persist(id,classification,' '),/invalid_confirmation/);
  await db.query("update analysis_sessions set expires_at=now()-interval '1 minute' where id=$1",[id]);
  await assert.rejects(persist(id),/analysis_session_unavailable/);
  assert.equal((await db.query('select count(*)::int as n from perceptions')).rows[0].n,0);
});
test('C: falha durante persistência reverte todo o registro e mantém sessão disponível', async () => {
  const id=await session();
  await db.exec("alter table perception_reviews add constraint reject_test check (reviewer_label <> 'Revisor teste')");
  await assert.rejects(persist(id),/reject_test/);
  assert.equal((await db.query('select count(*)::int as n from perceptions')).rows[0].n,0);
  assert.equal((await db.query('select consumed_at from analysis_sessions where id=$1',[id])).rows[0].consumed_at,null);
  await db.exec('alter table perception_reviews drop constraint reject_test');
  await persist(id);
});
test('C: sinônimos, legado e consolidação agrupam sem reescrever histórico', async () => {
  const first=await entity('Portal Corporativo'); await alias(first,'Portal');
  await persist(await session()); await persist(await session(),{...classification,sistema:'Portal Corporativo'});
  await db.exec("with p as (insert into perceptions(original_text) values('Legado') returning id) insert into classifications(perception_id,tipo,sistema,categoria_problema) select id,'reclamacao','Pórtal','erro' from p");
  let data=await analytics(); assert.equal(data.total_validated_perceptions,3); assert.equal(data.top_recurrences.length,1); assert.equal(data.by_system[0].occurrences,3);
  const target=await entity('Portal Unificado');
  await db.query("update entities set governance_status='consolidated',consolidated_into=$1 where id=$2",[target,first]);
  data=await analytics(); assert.equal(data.by_system[0].name,'Portal Unificado'); assert.equal(data.by_system[0].occurrences,3);
  assert.equal((await db.query('select entity_snapshot from perception_reviews limit 1')).rows[0].entity_snapshot.sistema.entity_id,first);
});
test('C: colisão de nomes não associa registro a uma entidade arbitrária', async () => {
  await entity('Portal'); const second=await entity('Outro'); await alias(second,'Portal');
  await persist(await session());
  assert.equal((await db.query('select sistema_entity_id from classifications')).rows[0].sistema_entity_id,null);
  assert.equal((await db.query('select count(*)::int as n from entity_evidence')).rows[0].n,0);
});
test('C: totais abrangem toda a base mesmo quando listas excedem 50 grupos', async () => {
  await db.exec("with p as (insert into perceptions(original_text) select 'Relato '||i from generate_series(1,65) i returning id,original_text) insert into classifications(perception_id,tipo,sistema,processo,categoria_problema) select id,'reclamacao','Portal',original_text,'erro' from p");
  const data=await analytics(); assert.equal(data.total_validated_perceptions,65); assert.equal(data.top_recurrences.length,50); assert.equal(data.by_system[0].occurrences,65); assert.equal(data.daily_evolution[0].occurrences,65);
});
test('C: tabelas de revisão e funções não são acessíveis diretamente pelo visitante', async () => {
  const result=(await db.query("select has_table_privilege('anon','perception_reviews','SELECT') as readable, has_function_privilege('anon','persist_reviewed_perception(uuid,jsonb,text,text)','EXECUTE') as executable, relrowsecurity from pg_class where oid='perception_reviews'::regclass")).rows[0];
  assert.equal(result.readable,false); assert.equal(result.executable,false); assert.equal(result.relrowsecurity,true);
  const invokers=await db.query("select prosecdef from pg_proc where proname in ('persist_reviewed_perception','canonical_operational_analytics')"); assert.ok(invokers.rows.every(r=>!r.prosecdef));
  const legacy=(await db.query("select has_function_privilege('anon','persist_validated_perception(uuid,jsonb)','EXECUTE') as anon, has_function_privilege('service_role','persist_validated_perception(uuid,jsonb)','EXECUTE') as server")).rows[0];
  assert.equal(legacy.anon,false); assert.equal(legacy.server,true);
});
test('C: migração também funciona após a migração de produto já aplicada', async () => {
  const c=migrationFiles.find(f=>f.includes('delivery_c')); const instance=await setup(migrationFiles.filter(f=>f<c));
  await instance.exec("with p as (insert into perceptions(original_text) values('Registro anterior') returning id) insert into classifications(perception_id,tipo,sistema,categoria_problema) select id,'reclamacao','Portal','erro' from p");
  await instance.exec(await readFile(new URL('../supabase/migrations/'+c,import.meta.url),'utf8'));
  assert.equal((await instance.query('select canonical_operational_analytics() as data')).rows[0].data.total_validated_perceptions,1); await instance.close();
});
test('C: endpoint valida revisão completa, repassa apenas valores e trata falhas', async () => {
  const payload={analysis_id:'11111111-1111-1111-1111-111111111111',classification,summary:'Resumo',reviewer_label:'Pessoa',entity_ids:{sistema:'fake'}};
  const args=parseConfirmation(payload); assert.equal(args.entity_ids,undefined); assert.equal(parseConfirmation({...payload,reviewer_label:''}),null);
  assert.equal(parseConfirmation({...payload,classification:{...classification,produto:'x'.repeat(161)}}),null);
  const request=body=>new Request('http://local',{method:'POST',body:JSON.stringify(body)});
  let calls=0; const handler=createRecordHandler(async a=>{ calls++; assert.deepEqual(a,args); return 'saved'; });
  assert.equal((await handler(request({...payload,summary:''}))).status,400); assert.equal(calls,0);
  assert.equal((await handler(request(payload))).status,201); assert.equal(calls,1);
  assert.equal((await createRecordHandler(async()=>{throw new Error('analysis_session_unavailable');})(request(payload))).status,409);
  assert.equal((await createRecordHandler(async()=>{throw new Error('secret');})(request(payload))).status,500);
});
test('C: tela exibe evidências com segurança, envia ajustes e permite repetir após erro', async () => {
  const {document,window}=parseHTML('<html><body></body></html>'); let calls=0;
  const data={summary:'Resumo',fields:structuredClone(fields)}; data.fields.sistema.sources[0].quote='<img src=x onerror=alert(1)>';
  const card=createReview({document,data,onCancel(){},async onConfirm(values,summary,reviewer){calls++; assert.equal(values.sistema,'Novo'); assert.equal(summary,'Revisado'); assert.equal(reviewer,'Pessoa'); if(calls===1) throw new Error('Tente novamente');}});
  document.body.append(card); assert.match(card.textContent,/Inferido pela IA/); assert.equal(card.querySelector('img'),null);
  card.querySelector('[name=sistema]').value='Novo'; card.querySelector('[name=summary]').value='Revisado';
  const form=card.querySelector('form'); const submit=()=>form.dispatchEvent(new window.Event('submit',{cancelable:true}));
  submit(); assert.equal(calls,0); card.querySelector('[name=reviewer_label]').value='Pessoa';
  submit(); submit(); await new Promise(r=>setImmediate(r)); assert.equal(calls,1); assert.match(card.textContent,/Tente novamente/);
  submit(); await new Promise(r=>setImmediate(r)); assert.equal(calls,2); assert.equal(card.querySelector('button'),null); assert.ok(card.querySelector('[name=sistema]').disabled);
});

async function queued(){await persist(await session());return (await db.query('select id from correction_curations order by created_at desc limit 1')).rows[0].id;}
async function approve(id){await db.query('select review_correction_example($1,true,$2,$3,$4,$5)',[id,'Portal falhou ao salvar',classification,'Curador teste','Texto generalizado e campos conferidos']);}
async function snapshot(){return (await db.query('select curated_example_snapshot() as data')).rows[0].data;}
async function publish(s){return db.query('select publish_curated_examples($1,$2,$3,$4)',[s.base_revision,s.candidate_fingerprint,'Curador teste',{status:'passed',candidate_fingerprint:s.candidate_fingerprint,report_sha256:'a'.repeat(64),reference:'fixture de teste, não avaliação real'}]);}
test('E: correção entra na fila uma vez e aprovação não publica automaticamente',async()=>{
  const id=await session();await persist(id);await persist(id);
  assert.equal((await db.query('select count(*)::int n from correction_curations')).rows[0].n,1);
  const c=(await db.query('select id,status from correction_curations')).rows[0];assert.equal(c.status,'pending');
  await approve(c.id);const s=await snapshot();assert.equal(s.baseline.examples.length,0);assert.equal(s.candidate.examples.length,1);
  assert.equal(s.candidate.examples[0].classification.sistema,'Portal');
});
test('E: confirmação sem mudanças não cria proposta artificial',async()=>{
  await persist(await session(),classification,'Proposta original');
  assert.equal((await db.query('select count(*)::int n from correction_curations')).rows[0].n,0);
});
test('E: rejeição exige justificativa e não altera o catálogo',async()=>{
  const id=await queued();await assert.rejects(db.query('select review_correction_example($1,false,null,null,$2,$3)',[id,'Curador','']),/invalid_review/);
  await db.query('select review_correction_example($1,false,null,null,$2,$3)',[id,'Curador','Não representa regra reutilizável']);
  assert.equal((await snapshot()).candidate.examples.length,0);await assert.rejects(approve(id),/curation_unavailable/);
});
test('E: publicação exige avaliação, detecta snapshot obsoleto e permite retirada auditada',async()=>{
  const id=await queued();await approve(id);const s=await snapshot();
  await assert.rejects(db.query('select publish_curated_examples($1,$2,$3,$4)',[s.base_revision,s.candidate_fingerprint,'Curador',{}]),/regression_required/);
  await assert.rejects(publish({...s,candidate_fingerprint:'outro'}),/stale_catalog/);
  await db.exec('set role service_role');await publish(s);
  assert.equal((await snapshot()).baseline.examples.length,1);
  await assert.rejects(publish(s),/stale_catalog/);
  await db.query('select retire_curated_example($1,$2,$3)',[id,'Curador','Regressão observada']);
  assert.equal((await snapshot()).baseline.examples.length,0);
  assert.equal((await db.query("select count(*)::int n from example_catalog_events where curation_id=$1",[id])).rows[0].n,2);
});
test('E: exemplo duplicado ou classificação inválida não é aprovado',async()=>{
  const first=await queued();await approve(first);const second=await queued();
  await assert.rejects(approve(second),/duplicate_example_text/);
  await assert.rejects(db.query('select review_correction_example($1,true,$2,$3,$4,$5)',[second,'Outro relato',{...classification,tipo:null},'Curador','Teste']),/invalid_example/);
});
test('E: recuperação usa apenas publicados e preserva identidade e versão',async()=>{
  await approve(await queued());let s=await snapshot();
  const client={rpc:()=>({abortSignal:async()=>({data:s.baseline,error:null})})};
  assert.equal((await loadCuratedExamples(client)).examples.length,0);await publish(s);s=await snapshot();
  const catalog=await loadCuratedExamples(client);const context=selectContext([{role:'user',text:'Portal falhou ao salvar'}],{entities:[],aliases:[],complete:true},catalog);
  assert.equal(context.examples.length,1);assert.equal(context.examples_version,s.baseline.version);assert.equal(context.examples[0].id,s.baseline.examples[0].id);
  await assert.rejects(loadCuratedExamples({rpc:()=>({abortSignal:async()=>({error:{message:'offline'}})})}),/knowledge_unavailable/);
});
async function regression(s){
  const run={dataset_sha256:'same-dataset',contract_sha256:await jsonHash(classificationSchema),taxonomy_sha256:await jsonHash(taxonomy),dictionary_sha256:'same-dictionary',split:'test',model:'fixture',prompt_version:PROMPT_VERSION,contract_version:'classification.1',taxonomy_version:'operational-taxonomy.1'};
  const metrics={total_cases:1,human_reviewed_cases:1,missing:0,contract:{valid:1,total:1},fields:Object.fromEntries(Object.keys(classification).map(f=>[f,{correct:1,total:1}])),premature_reviews:0,unnecessary_questions:0,details:[{case_id:'fixture',valid:true,mismatched_fields:[],readiness_correct:true,single_issue_correct:true}]};
  return {baseline:{...structuredClone(metrics),run:{...run,examples_sha256:await jsonHash(s.baseline)}},candidate:{...structuredClone(metrics),run:{...run,examples_sha256:await jsonHash(s.candidate)}},human_review:{reviewed_by:'Curador teste',reviewed_at:'2026-10-09',no_fabrications:true,no_semantic_regressions:true,reference:'Somente fixture automatizada'}};
}
test('E: gate aceita comparação compatível e bloqueia regressão, ausência de revisão e catálogo alterado',async()=>{
  await approve(await queued());const s=await snapshot(),report=await regression(s);
  assert.equal((await assessRegression(report,s)).status,'passed');
  for(const mutate of [r=>r.candidate.details[0].mismatched_fields.push('sistema'),r=>r.candidate.details[0].readiness_correct=false,r=>r.candidate.run.model='different',r=>r.candidate.human_reviewed_cases=0,r=>r.human_review.no_fabrications=null,r=>r.candidate.run.examples_sha256='stale']){
    const copy=structuredClone(report);mutate(copy);await assert.rejects(assessRegression(copy,s),/invalid_regression/);
  }
});
test('E: endpoint recusa decisão incompleta e passa relatório validado para publicação',async()=>{
  await approve(await queued());const s=await snapshot();let published=0;
  const handler=createCurationHandler({snapshot:async()=>s,publish:async p=>{published++;assert.equal(p.p_regression.status,'passed');return 1;}});
  const req=p=>new Request('http://local',{method:'POST',body:JSON.stringify(p)});
  assert.equal((await handler(req({operation:'publish',actor:'Pessoa',report:{}}))).status,400);assert.equal(published,0);
  assert.equal((await handler(req({operation:'publish',actor:'Pessoa',report:await regression(s)}))).status,200);assert.equal(published,1);
});
test('E: tabelas e RPCs são exclusivas do servidor',async()=>{
  const p=(await db.query("select has_table_privilege('anon','correction_curations','SELECT') a, has_function_privilege('anon','curated_example_snapshot()','EXECUTE') b, has_function_privilege('service_role','curated_example_snapshot()','EXECUTE') c")).rows[0];
  assert.deepEqual(p,{a:false,b:false,c:true});
});
test('E: tela exige curador e justificativa, não executa HTML do relato e bloqueia duplicação',async()=>{
  const {document,window}=parseHTML('<html><body></body></html>');let calls=0;
  const card=curationCard(document,{id:'fixture',status:'pending',perception_reviews:{perceptions:{original_text:'<script>bad()</script>'},final_classification:classification,changes:{sistema:{before:null,after:'Portal'}}}},async(op,p)=>{calls++;assert.equal(op,'review');assert.equal(p.actor,'Pessoa');});document.body.append(card);
  assert.equal(card.querySelector('script'),null);const approve=card.querySelector('button');approve.click();assert.equal(calls,0);
  card.querySelector('[name=actor]').value='Pessoa';card.querySelector('[name=note]').value='Campos revisados';approve.click();approve.click();await new Promise(r=>setImmediate(r));assert.equal(calls,1);assert.equal(card.querySelector('button'),null);
});
