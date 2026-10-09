-- Delivery C follows the produto migration. Timestamp adjusted after CLI
-- scaffolding to preserve deployment ordering. Does not rewrite raw text.
alter table public.classifications add column if not exists produto text;
alter table public.classifications add column if not exists validated_summary text;
alter table public.classifications add column if not exists processo_entity_id uuid references public.entities(id);
alter table public.classifications add column if not exists subprocesso_entity_id uuid references public.entities(id);
alter table public.classifications add column if not exists sistema_entity_id uuid references public.entities(id);
alter table public.classifications add column if not exists produto_entity_id uuid references public.entities(id);

create table public.perception_reviews (
  perception_id uuid primary key references public.perceptions(id),
  analysis_session_id uuid not null unique references public.analysis_sessions(id),
  reviewer_label text not null check (char_length(trim(reviewer_label)) between 1 and 120),
  reviewer_verification text not null default 'self_declared' check (reviewer_verification = 'self_declared'),
  proposed_summary text,
  final_summary text not null check (char_length(trim(final_summary)) between 1 and 1200),
  proposed_fields jsonb not null,
  final_classification jsonb not null,
  changes jsonb not null,
  entity_snapshot jsonb not null,
  provenance jsonb not null,
  reviewed_at timestamptz not null default now()
);
alter table public.perception_reviews enable row level security;
revoke all on public.perception_reviews from public, anon, authenticated;
grant select, insert on public.perception_reviews to service_role;

create function public.classification_name_key(p_value text)
returns text language sql immutable strict parallel safe
set search_path = '' as $$
  select trim(regexp_replace(translate(lower(p_value),
    'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '[^[:alnum:]]+', ' ', 'g'))
$$;
create index entities_classification_name_idx on public.entities (entity_type, public.classification_name_key(canonical_name));
create index aliases_classification_name_idx on public.entity_aliases (entity_type, public.classification_name_key(alias));
create index classifications_processo_entity_idx on public.classifications(processo_entity_id);
create index classifications_subprocesso_entity_idx on public.classifications(subprocesso_entity_id);
create index classifications_sistema_entity_idx on public.classifications(sistema_entity_id);
create index classifications_produto_entity_idx on public.classifications(produto_entity_id);

create function public.current_classification_entity(p_id uuid)
returns uuid language sql stable security invoker set search_path = '' as $$
  with recursive chain as (
    select e.id, e.consolidated_into, e.governance_status, array[e.id] as path
    from public.entities e where e.id = p_id
    union all
    select e.id, e.consolidated_into, e.governance_status, c.path || e.id
    from public.entities e join chain c on e.id = c.consolidated_into
    where c.governance_status = 'consolidated' and not e.id = any(c.path) and cardinality(c.path) < 32
  )
  select id from chain where governance_status = 'homologated' and consolidated_into is null limit 1
$$;

create function public.lookup_classification_entity(p_type text, p_value text)
returns uuid language sql stable security invoker set search_path = '' as $$
  with matches as (
    select e.id from public.entities e
    where e.entity_type = p_type and public.classification_name_key(e.canonical_name) = public.classification_name_key(p_value)
    union
    select e.id from public.entity_aliases a join public.entities e on e.id = a.entity_id
    where a.entity_type = p_type and e.entity_type = p_type
      and public.classification_name_key(a.alias) = public.classification_name_key(p_value)
  ), roots as (select public.current_classification_entity(id) as id from matches)
  select case when count(*) > 0 and count(id) = count(*) and count(distinct id) = 1
    then (array_agg(id))[1] else null end from roots
$$;

create function public.persist_reviewed_perception(
  p_session_id uuid, p_classification jsonb, p_summary text, p_reviewer_label text
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  s public.analysis_sessions%rowtype;
  prior public.perception_reviews%rowtype;
  result_id uuid;
  clean jsonb := '{}'::jsonb;
  changes jsonb := '{}'::jsonb;
  entity_snapshot jsonb := '{}'::jsonb;
  entity_ids jsonb := '{}'::jsonb;
  field text;
  final_value text;
  ai_value text;
  entity_id uuid;
  entity_name text;
  evidence_state text;
  match_count integer;
begin
  if jsonb_typeof(p_classification) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_classification)) <> 6
    or not p_classification ?& array['tipo','processo','subprocesso','sistema','produto','categoria_problema']
    or p_summary is null or char_length(trim(p_summary)) not between 1 and 1200
    or p_reviewer_label is null or char_length(trim(p_reviewer_label)) not between 1 and 120 then
    raise exception 'invalid_confirmation';
  end if;
  foreach field in array array['tipo','processo','subprocesso','sistema','produto','categoria_problema'] loop
    if jsonb_typeof(p_classification->field) not in ('string','null') then raise exception 'invalid_confirmation'; end if;
    final_value := nullif(trim(p_classification->>field), '');
    if char_length(final_value) > 160 then raise exception 'invalid_confirmation'; end if;
    clean := clean || jsonb_build_object(field, final_value);
  end loop;
  if clean->>'tipo' is null or clean->>'tipo' not in ('reclamacao','sugestao','duvida','elogio','outro')
    or clean->>'categoria_problema' is null or clean->>'categoria_problema' not in ('erro','lentidao','acesso','usabilidade','integracao','processo','informacao','outro') then
    raise exception 'invalid_confirmation';
  end if;
  select * into s from public.analysis_sessions where id = p_session_id for update;
  if not found then raise exception 'analysis_session_unavailable'; end if;
  if s.consumed_at is not null then
    select * into prior from public.perception_reviews where analysis_session_id = p_session_id;
    if found and prior.final_classification = clean and prior.final_summary = trim(p_summary) and prior.reviewer_label = trim(p_reviewer_label) then
      return prior.perception_id;
    end if;
    raise exception 'analysis_session_unavailable';
  end if;
  if s.expires_at <= now() then raise exception 'analysis_session_unavailable'; end if;

  insert into public.perceptions(original_text) values(s.original_text) returning id into result_id;
  insert into public.ai_interpretations(perception_id, prompt_version, raw_response, interpretation)
    values(result_id, s.prompt_version, s.raw_response, s.proposed_interpretation->>'interpretation');

  foreach field in array array['tipo','processo','subprocesso','sistema','produto','categoria_problema'] loop
    ai_value := s.proposed_interpretation->'fields'->field->>'value';
    final_value := clean->>field;
    if ai_value is distinct from final_value then
      changes := changes || jsonb_build_object(field, jsonb_build_object('before', ai_value, 'after', final_value));
      insert into public.corrections(perception_id, field, ai_value, final_value) values(result_id, field, ai_value, final_value);
    end if;
    if field in ('processo','subprocesso','sistema','produto') then
      entity_id := public.lookup_classification_entity(field, final_value);
      entity_name := null;
      if entity_id is not null then select canonical_name into entity_name from public.entities where id = entity_id; end if;
      entity_ids := entity_ids || jsonb_build_object(field, entity_id);
      entity_snapshot := entity_snapshot || jsonb_build_object(field,
        jsonb_build_object('original_value', final_value, 'entity_id', entity_id, 'canonical_name', entity_name));
      if final_value is not null then
        -- Never inherit the AI evidence label when the human changed the value.
        evidence_state := case when ai_value is distinct from final_value then 'observed'
          else coalesce(s.proposed_interpretation->'fields'->field->>'evidence', 'observed') end;
        if evidence_state not in ('observed','inferred','suggested') then evidence_state := 'observed'; end if;
        if entity_id is not null then
          insert into public.entity_evidence(entity_id, perception_id, field_name, extracted_value, evidence_state)
            values(entity_id, result_id, field, final_value, evidence_state);
        else
          select count(*) into match_count from (
            select e.id from public.entities e where e.entity_type = field and public.classification_name_key(e.canonical_name) = public.classification_name_key(final_value)
            union select a.entity_id from public.entity_aliases a where a.entity_type = field and public.classification_name_key(a.alias) = public.classification_name_key(final_value)
          ) matches;
          if match_count <= 1 then
            perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(field || ':' || public.classification_name_key(final_value), 0));
            perform public.register_entity_evidence(result_id, field, field, final_value, evidence_state);
          end if;
        end if;
      end if;
    end if;
  end loop;
  if s.proposed_interpretation->>'interpretation' is distinct from trim(p_summary) then
    changes := changes || jsonb_build_object('summary', jsonb_build_object('before', s.proposed_interpretation->>'interpretation', 'after', trim(p_summary)));
  end if;
  insert into public.classifications(perception_id, tipo, processo, subprocesso, sistema, produto, categoria_problema, validated_summary,
    processo_entity_id, subprocesso_entity_id, sistema_entity_id, produto_entity_id)
  values(result_id, clean->>'tipo', clean->>'processo', clean->>'subprocesso', clean->>'sistema', clean->>'produto', clean->>'categoria_problema', trim(p_summary),
    (entity_ids->>'processo')::uuid, (entity_ids->>'subprocesso')::uuid, (entity_ids->>'sistema')::uuid, (entity_ids->>'produto')::uuid);
  insert into public.perception_reviews(perception_id, analysis_session_id, reviewer_label, proposed_summary, final_summary, proposed_fields, final_classification, changes, entity_snapshot, provenance)
    values(result_id, p_session_id, trim(p_reviewer_label), s.proposed_interpretation->>'interpretation', trim(p_summary), s.proposed_interpretation->'fields', clean, changes, entity_snapshot,
      jsonb_build_object('model', s.model, 'prompt_version', s.prompt_version, 'contract_version', s.proposed_interpretation->>'contract_version', 'taxonomy_version', s.proposed_interpretation->>'taxonomy_version', 'knowledge', s.proposed_interpretation->'knowledge'));
  update public.analysis_sessions set consumed_at = now() where id = p_session_id;
  return result_id;
end;
$$;

-- Current governance determines analytical grouping; historical values and
-- review snapshots stay intact. Null IDs use namespaced raw keys, never IDs.
create view public.canonical_classifications with (security_invoker = true) as
select c.perception_id, p.created_at, c.categoria_problema,
  coalesce(es.canonical_name, c.sistema) as sistema,
  coalesce(ep.canonical_name, c.processo) as processo,
  coalesce(eu.canonical_name, c.subprocesso) as subprocesso,
  coalesce(et.canonical_name, c.produto) as produto,
  coalesce('id:' || ids.s::text, 'raw:' || public.classification_name_key(c.sistema), 'absent:') as sistema_key,
  coalesce('id:' || ids.p::text, 'raw:' || public.classification_name_key(c.processo), 'absent:') as processo_key,
  coalesce('id:' || ids.u::text, 'raw:' || public.classification_name_key(c.subprocesso), 'absent:') as subprocesso_key,
  coalesce('id:' || ids.t::text, 'raw:' || public.classification_name_key(c.produto), 'absent:') as produto_key
from public.classifications c join public.perceptions p on p.id = c.perception_id
cross join lateral (select
  coalesce(public.current_classification_entity(c.sistema_entity_id), public.lookup_classification_entity('sistema',c.sistema)) as s,
  coalesce(public.current_classification_entity(c.processo_entity_id), public.lookup_classification_entity('processo',c.processo)) as p,
  coalesce(public.current_classification_entity(c.subprocesso_entity_id), public.lookup_classification_entity('subprocesso',c.subprocesso)) as u,
  coalesce(public.current_classification_entity(c.produto_entity_id), public.lookup_classification_entity('produto',c.produto)) as t
) ids
left join public.entities es on es.id = ids.s left join public.entities ep on ep.id = ids.p
left join public.entities eu on eu.id = ids.u left join public.entities et on et.id = ids.t;

create view public.canonical_recurrence_summary with (security_invoker = true) as
select sistema_key, processo_key, subprocesso_key, produto_key, categoria_problema,
  min(sistema) as sistema, min(processo) as processo, min(subprocesso) as subprocesso, min(produto) as produto,
  count(*)::integer as occurrences, min(created_at) as first_seen_at, max(created_at) as last_seen_at
from public.canonical_classifications group by sistema_key, processo_key, subprocesso_key, produto_key, categoria_problema;

create function public.canonical_operational_analytics()
returns jsonb language sql stable security invoker set search_path = '' as $$
with base as materialized (select * from public.canonical_classifications),
combinations as (select sistema_key, processo_key, subprocesso_key, produto_key, categoria_problema,
  min(sistema) as sistema, min(processo) as processo, min(subprocesso) as subprocesso, min(produto) as produto, count(*)::integer as occurrences
  from base group by sistema_key, processo_key, subprocesso_key, produto_key, categoria_problema),
systems as (select sistema_key as key, coalesce(min(sistema),'Não informado') as name, count(*)::integer as occurrences from base group by sistema_key),
processes as (select processo_key as key, coalesce(min(processo),'Não informado') as name, count(*)::integer as occurrences from base group by processo_key),
products as (select produto_key as key, coalesce(min(produto),'Não informado') as name, count(*)::integer as occurrences from base group by produto_key),
daily as (select (created_at at time zone 'America/Fortaleza')::date as occurrence_date, count(*)::integer as occurrences
  from base group by (created_at at time zone 'America/Fortaleza')::date order by occurrence_date desc limit 200)
select jsonb_build_object(
  'total_validated_perceptions', (select count(*) from base),
  'recurring_combinations', (select count(*) from combinations where occurrences > 1),
  'top_recurrences', coalesce((select jsonb_agg(r order by occurrences desc, sistema_key, processo_key, subprocesso_key, produto_key, categoria_problema) from (select * from combinations order by occurrences desc, sistema_key, processo_key, subprocesso_key, produto_key, categoria_problema limit 50) r),'[]'::jsonb),
  'by_system', coalesce((select jsonb_agg(r order by occurrences desc, key) from (select * from systems order by occurrences desc, key limit 50) r),'[]'::jsonb),
  'by_process', coalesce((select jsonb_agg(r order by occurrences desc, key) from (select * from processes order by occurrences desc, key limit 50) r),'[]'::jsonb),
  'by_product', coalesce((select jsonb_agg(r order by occurrences desc, key) from (select * from products order by occurrences desc, key limit 50) r),'[]'::jsonb),
  'daily_evolution', coalesce((select jsonb_agg(d order by occurrence_date) from daily d),'[]'::jsonb),
  'grouping', 'canonical', 'daily_timezone', 'America/Fortaleza', 'daily_limit', 200,
  'unit_coverage', jsonb_build_object('available',false,'message','Unidade não é coletada no fluxo atual.'),
  'note', 'Nomes e sinônimos homologados são agrupados pela mesma entidade. Totais incluem todos os registros; listas mostram até 50 grupos e evolução até 200 dias com registros.'
)
$$;

revoke all on function public.classification_name_key(text), public.current_classification_entity(uuid), public.lookup_classification_entity(text,text),
  public.persist_reviewed_perception(uuid,jsonb,text,text), public.canonical_operational_analytics() from public, anon, authenticated;
grant execute on function public.classification_name_key(text), public.current_classification_entity(uuid), public.lookup_classification_entity(text,text),
  public.persist_reviewed_perception(uuid,jsonb,text,text), public.canonical_operational_analytics() to service_role;
revoke all on public.canonical_classifications, public.canonical_recurrence_summary from public, anon, authenticated;
grant select on public.canonical_classifications, public.canonical_recurrence_summary to service_role;
grant select, insert, update on public.analysis_sessions to service_role;
grant select, insert on public.perceptions, public.ai_interpretations, public.classifications, public.corrections, public.entity_evidence to service_role;
grant select on public.entities, public.entity_aliases to service_role;
