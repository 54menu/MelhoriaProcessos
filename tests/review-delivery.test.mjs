import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { parseHTML } from "linkedom";
import { createReview } from "../js/review.mjs";
import { parseConfirmation, createRecordHandler } from "../supabase/functions/_shared/review-confirmation.mjs";

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
  const c=migrationFiles.find(f=>f.includes('delivery_c')); const instance=await setup(migrationFiles.filter(f=>f!==c));
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
