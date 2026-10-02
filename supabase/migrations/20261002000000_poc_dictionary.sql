-- POC evolutivo 2/4: Dicionario Operacional Evolutivo, versao aberta (sem auth).
-- Pressupoe baseline 20260930000000 aplicada. RLS habilitado sem policies:
-- somente service_role (Edge Functions) acessa.

create table if not exists public.entities (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('processo', 'subprocesso', 'sistema')),
  canonical_name text not null check (char_length(trim(canonical_name)) between 1 and 160),
  normalized_name text not null,
  governance_status text not null default 'candidate' check (governance_status in ('candidate', 'homologated', 'rejected', 'consolidated')),
  consolidated_into uuid references public.entities(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  homologated_at timestamptz,
  rejected_at timestamptz,
  check ((governance_status = 'consolidated') = (consolidated_into is not null)),
  unique (entity_type, normalized_name)
);

create table if not exists public.entity_aliases (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete restrict,
  entity_type text not null check (entity_type in ('processo', 'subprocesso', 'sistema')),
  alias text not null check (char_length(trim(alias)) between 1 and 160),
  normalized_alias text not null,
  created_at timestamptz not null default now(),
  unique (entity_type, normalized_alias)
);

create table if not exists public.entity_evidence (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete restrict,
  perception_id uuid not null references public.perceptions(id) on delete restrict,
  field_name text not null check (field_name in ('processo', 'subprocesso', 'sistema')),
  extracted_value text not null,
  evidence_state text not null check (evidence_state in ('observed', 'inferred', 'suggested')),
  created_at timestamptz not null default now(),
  unique (entity_id, perception_id, field_name)
);

create table if not exists public.entity_governance_events (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete restrict,
  action text not null check (action in ('homologated', 'rejected', 'alias_added', 'consolidated')),
  actor_id uuid,
  target_entity_id uuid references public.entities(id) on delete restrict,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.entities enable row level security;
alter table public.entity_aliases enable row level security;
alter table public.entity_evidence enable row level security;
alter table public.entity_governance_events enable row level security;

create or replace function public.normalize_entity_name(p_value text)
returns text
language sql
immutable
strict
as $$
  select lower(trim(regexp_replace(p_value, '[[:space:]]+', ' ', 'g')))
$$;

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
  if p_entity_type not in ('processo', 'subprocesso', 'sistema') then return null; end if;
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
    values (trim(p_value), trim(p_value), v_normalized)
    returning id into v_entity_id;
  end if;
  insert into public.entity_evidence (entity_id, perception_id, field_name, extracted_value, evidence_state)
  values (v_entity_id, p_perception_id, p_field_name, trim(p_value), p_evidence_state)
  on conflict (entity_id, perception_id, field_name) do nothing;
  return v_entity_id;
end;
$$;

create or replace view public.dictionary_entity_summary
with (security_invoker = true)
as
select
  e.id, e.entity_type, e.canonical_name, e.governance_status, e.consolidated_into,
  e.created_at, e.updated_at, e.homologated_at, e.rejected_at,
  count(ev.id)::integer as evidence_count,
  count(distinct ev.perception_id)::integer as perception_count,
  max(ev.created_at) as last_evidence_at
from public.entities e
left join public.entity_evidence ev on ev.entity_id = e.id
group by e.id;

-- Retroage percepcoes ja validadas antes deste ponto evolutivo.
select public.register_entity_evidence(c.perception_id, values_to_register.entity_type, values_to_register.entity_type, values_to_register.entity_value, 'observed')
from public.classifications c
cross join lateral (
  values
    ('processo', c.processo),
    ('subprocesso', c.subprocesso),
    ('sistema', c.sistema)
) as values_to_register(entity_type, entity_value)
where values_to_register.entity_value is not null and trim(values_to_register.entity_value) <> '';

-- Estende persistencia da baseline para alimentar o dicionario a cada confirmacao.
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
  insert into public.classifications (perception_id, tipo, processo, subprocesso, sistema, categoria_problema)
  values (v_perception_id, p_classification->>'tipo', nullif(p_classification->>'processo', ''), nullif(p_classification->>'subprocesso', ''), nullif(p_classification->>'sistema', ''), p_classification->>'categoria_problema');
  foreach v_field in array array['tipo', 'processo', 'subprocesso', 'sistema', 'categoria_problema'] loop
    v_ai_value := v_session.proposed_interpretation->'fields'->v_field->>'value';
    v_final_value := nullif(p_classification->>v_field, '');
    if v_ai_value is distinct from v_final_value then
      insert into public.corrections (perception_id, field, ai_value, final_value)
      values (v_perception_id, v_field, v_ai_value, v_final_value);
    end if;
  end loop;
  foreach v_field in array array['processo', 'subprocesso', 'sistema'] loop
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

create or replace function public.consolidate_entities(p_source_id uuid, p_target_id uuid, p_actor_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.entities%rowtype;
  v_target public.entities%rowtype;
begin
  select * into v_source from public.entities where id = p_source_id for update;
  select * into v_target from public.entities where id = p_target_id for update;
  if v_source.id is null or v_target.id is null or v_source.id = v_target.id
     or v_source.entity_type <> v_target.entity_type
     or v_target.governance_status = 'consolidated' then
    raise exception 'invalid_consolidation';
  end if;
  delete from public.entity_evidence source_evidence
  using public.entity_evidence target_evidence
  where source_evidence.entity_id = p_source_id
    and target_evidence.entity_id = p_target_id
    and source_evidence.perception_id = target_evidence.perception_id
    and source_evidence.field_name = target_evidence.field_name;
  update public.entity_evidence set entity_id = p_target_id where entity_id = p_source_id;
  update public.entities set governance_status = 'consolidated', consolidated_into = p_target_id, updated_at = now() where id = p_source_id;
  insert into public.entity_aliases (entity_id, entity_type, alias, normalized_alias)
  values (p_target_id, v_source.entity_type, v_source.canonical_name, public.normalize_entity_name(v_source.canonical_name))
  on conflict (entity_type, normalized_alias) do nothing;
  insert into public.entity_governance_events (entity_id, action, actor_id, target_entity_id)
  values (p_source_id, 'consolidated', p_actor_id, p_target_id);
end;
$$;

revoke all on function public.normalize_entity_name(text) from public;
revoke all on function public.register_entity_evidence(uuid, text, text, text, text) from public;
revoke all on function public.persist_validated_perception(uuid, jsonb) from public;
revoke all on function public.consolidate_entities(uuid, uuid, uuid) from public;
grant execute on function public.normalize_entity_name(text) to service_role;
grant execute on function public.register_entity_evidence(uuid, text, text, text, text) to service_role;
grant execute on function public.persist_validated_perception(uuid, jsonb) to service_role;
grant execute on function public.consolidate_entities(uuid, uuid, uuid) to service_role;
