-- POC evolutivo: campo PRODUTO (texto livre, opcional).
-- Processo/subprocesso/sistema normalmente pertencem a um produto
-- (Consorcio, CDC, etc.). Produto vira 4o eixo: classificado, candidato a
-- entidade no dicionario, dimensao de recorrencia e de anomalia.
-- Coluna nullable: registros antigos permanecem sem produto, sem backfill.

alter table public.classifications add column if not exists produto text;

alter table public.corrections drop constraint if exists corrections_field_check;
alter table public.corrections
  add constraint corrections_field_check
  check (field in ('tipo', 'processo', 'subprocesso', 'sistema', 'produto', 'categoria_problema'));

alter table public.entities drop constraint if exists entities_entity_type_check;
alter table public.entities
  add constraint entities_entity_type_check
  check (entity_type in ('processo', 'subprocesso', 'sistema', 'produto'));

alter table public.entity_aliases drop constraint if exists entity_aliases_entity_type_check;
alter table public.entity_aliases
  add constraint entity_aliases_entity_type_check
  check (entity_type in ('processo', 'subprocesso', 'sistema', 'produto'));

alter table public.entity_evidence drop constraint if exists entity_evidence_field_name_check;
alter table public.entity_evidence
  add constraint entity_evidence_field_name_check
  check (field_name in ('processo', 'subprocesso', 'sistema', 'produto'));

create or replace function public.register_entity_evidence(
  p_perception_id uuid,
  p_entity_type text,
  p_field_name text,
  p_value text,
  p_evidence_state text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_normalized text;
  v_entity_id uuid;
  v_consolidated_into uuid;
begin
  if p_value is null or trim(p_value) = '' then return null; end if;
  if p_entity_type not in ('processo', 'subprocesso', 'sistema', 'produto') then return null; end if;
  if p_evidence_state not in ('observed', 'inferred', 'suggested') then
    p_evidence_state := 'observed';
  end if;
  v_normalized := public.normalize_entity_name(p_value);
  select e.id into v_entity_id from public.entities e
  where e.entity_type = p_entity_type and e.normalized_name = v_normalized;
  if v_entity_id is null then
    select a.entity_id into v_entity_id from public.entity_aliases a
    where a.entity_type = p_entity_type and a.normalized_alias = v_normalized;
  end if;
  if v_entity_id is not null then
    select consolidated_into into v_consolidated_into from public.entities where id = v_entity_id;
    if v_consolidated_into is not null then v_entity_id := v_consolidated_into; end if;
  end if;
  if v_entity_id is null then
    insert into public.entities (entity_type, canonical_name, normalized_name)
    values (p_entity_type, trim(p_value), v_normalized)
    returning id into v_entity_id;
  end if;
  insert into public.entity_evidence (entity_id, perception_id, field_name, extracted_value, evidence_state)
  values (v_entity_id, p_perception_id, p_field_name, trim(p_value), p_evidence_state)
  on conflict (entity_id, perception_id, field_name) do nothing;
  return v_entity_id;
end;
$$;

create or replace function public.persist_validated_perception(p_session_id uuid, p_classification jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.analysis_sessions%rowtype;
  v_perception_id uuid;
  v_field text;
  v_ai_value text;
  v_final_value text;
  v_state text;
begin
  select * into v_session from public.analysis_sessions
  where id = p_session_id and consumed_at is null and expires_at > now()
  for update;
  if not found then
    raise exception 'analysis_session_unavailable';
  end if;
  if p_classification->>'tipo' not in ('reclamacao', 'sugestao', 'duvida', 'elogio', 'outro')
     or p_classification->>'categoria_problema' not in ('erro', 'lentidao', 'acesso', 'usabilidade', 'integracao', 'processo', 'informacao', 'outro') then
    raise exception 'invalid_classification';
  end if;
  insert into public.perceptions (original_text) values (v_session.original_text) returning id into v_perception_id;
  insert into public.ai_interpretations (perception_id, prompt_version, raw_response, interpretation)
  values (v_perception_id, v_session.prompt_version, v_session.raw_response, v_session.proposed_interpretation->>'interpretation');
  insert into public.classifications (perception_id, tipo, processo, subprocesso, sistema, produto, categoria_problema)
  values (v_perception_id, p_classification->>'tipo', nullif(p_classification->>'processo', ''), nullif(p_classification->>'subprocesso', ''), nullif(p_classification->>'sistema', ''), nullif(p_classification->>'produto', ''), p_classification->>'categoria_problema');
  foreach v_field in array array['tipo', 'processo', 'subprocesso', 'sistema', 'produto', 'categoria_problema'] loop
    v_ai_value := v_session.proposed_interpretation->'fields'->v_field->>'value';
    v_final_value := nullif(p_classification->>v_field, '');
    if v_ai_value is distinct from v_final_value then
      insert into public.corrections (perception_id, field, ai_value, final_value)
      values (v_perception_id, v_field, v_ai_value, v_final_value);
    end if;
  end loop;
  foreach v_field in array array['processo', 'subprocesso', 'sistema', 'produto'] loop
    v_final_value := nullif(p_classification->>v_field, '');
    if v_final_value is not null then
      v_state := coalesce(v_session.proposed_interpretation->'fields'->v_field->>'evidence', 'observed');
      if v_state not in ('observed', 'inferred', 'suggested') then v_state := 'observed'; end if;
      perform public.register_entity_evidence(v_perception_id, v_field, v_field, v_final_value, v_state);
    end if;
  end loop;
  update public.analysis_sessions set consumed_at = now() where id = p_session_id;
  return v_perception_id;
end;
$$;

drop view if exists public.recurrence_summary;
create view public.recurrence_summary
with (security_invoker = true)
as
select
  c.sistema,
  c.processo,
  c.subprocesso,
  c.produto,
  c.categoria_problema,
  count(*)::integer as occurrences,
  min(p.created_at) as first_seen_at,
  max(p.created_at) as last_seen_at
from public.classifications c
join public.perceptions p on p.id = c.perception_id
group by c.sistema, c.processo, c.subprocesso, c.produto, c.categoria_problema;

drop view if exists public.recurrence_daily;
create view public.recurrence_daily
with (security_invoker = true)
as
select
  date_trunc('day', p.created_at)::date as occurrence_date,
  c.sistema,
  c.processo,
  c.produto,
  c.categoria_problema,
  count(*)::integer as occurrences
from public.classifications c
join public.perceptions p on p.id = c.perception_id
group by date_trunc('day', p.created_at)::date, c.sistema, c.processo, c.produto, c.categoria_problema;

drop function if exists public.operational_anomalies();
create function public.operational_anomalies()
returns table (sistema text, processo text, produto text, categoria_problema text, recent_occurrences integer, prior_daily_average numeric, growth_ratio numeric)
language sql
stable
security definer
set search_path = public
as $$
  with counts as (
    select c.sistema, c.processo, c.produto, c.categoria_problema,
      count(*) filter (where p.created_at >= now() - interval '7 days')::integer as recent_count,
      count(*) filter (where p.created_at >= now() - interval '37 days' and p.created_at < now() - interval '7 days')::numeric / 30 as prior_daily_average
    from public.classifications c join public.perceptions p on p.id = c.perception_id
    group by c.sistema, c.processo, c.produto, c.categoria_problema
  )
  select sistema, processo, produto, categoria_problema, recent_count, prior_daily_average,
    case when prior_daily_average = 0 then null else round(recent_count / (prior_daily_average * 7), 2) end
  from counts
  where recent_count >= 2 and (prior_daily_average = 0 or recent_count / greatest(prior_daily_average * 7, 1) >= 2)
  order by recent_count desc
$$;

revoke all on function public.register_entity_evidence(uuid, text, text, text, text) from public;
grant execute on function public.register_entity_evidence(uuid, text, text, text, text) to service_role;
revoke all on function public.persist_validated_perception(uuid, jsonb) from public;
grant execute on function public.persist_validated_perception(uuid, jsonb) to service_role;
revoke all on function public.operational_anomalies() from public;
grant execute on function public.operational_anomalies() to service_role;
