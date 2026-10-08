-- Correcao POC: register_entity_evidence gravava o valor extraido na coluna
-- entity_type (violava entities_entity_type_check e quebrava todo registro com
-- processo/subprocesso/sistema). O tipo correto e p_entity_type.

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
    values (p_entity_type, trim(p_value), v_normalized)
    returning id into v_entity_id;
  end if;
  insert into public.entity_evidence (entity_id, perception_id, field_name, extracted_value, evidence_state)
  values (v_entity_id, p_perception_id, p_field_name, trim(p_value), p_evidence_state)
  on conflict (entity_id, perception_id, field_name) do nothing;
  return v_entity_id;
end;
$$;

revoke all on function public.register_entity_evidence(uuid, text, text, text, text) from public;
grant execute on function public.register_entity_evidence(uuid, text, text, text, text) to service_role;
