-- POC evolutivo 5: evolucao assistida do conhecimento, versao aberta (sem auth).
-- Pressupoe baseline + dicionario aplicados. RLS habilitado sem policies:
-- somente service_role (Edge Functions) acessa.
-- IA sugere (pending); humano aprova/rejeita em tela; sistema aplica.

create table if not exists public.knowledge_suggestions (
  id uuid primary key default gen_random_uuid(),
  suggestion_type text not null check (suggestion_type in ('discover', 'group', 'relate', 'refine')),
  proposal jsonb not null,
  fingerprint text not null unique,
  evidence jsonb not null default '[]'::jsonb,
  raw_response jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  prompt_version text not null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  review_note text
);

create table if not exists public.entity_relations (
  id uuid primary key default gen_random_uuid(),
  source_entity_id uuid not null references public.entities(id) on delete restrict,
  target_entity_id uuid not null references public.entities(id) on delete restrict,
  relation_type text not null default 'associated_with' check (relation_type in ('associated_with')),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  created_at timestamptz not null default now(),
  check (source_entity_id <> target_entity_id),
  unique (source_entity_id, target_entity_id, relation_type)
);

create table if not exists public.taxonomy_refinements (
  id uuid primary key default gen_random_uuid(),
  parent_category text not null check (char_length(trim(parent_category)) between 1 and 80),
  proposed_category text not null check (char_length(trim(proposed_category)) between 1 and 80),
  rationale text not null,
  evidence jsonb not null default '[]'::jsonb,
  status text not null default 'approved' check (status in ('approved', 'rejected')),
  created_at timestamptz not null default now(),
  unique (parent_category, proposed_category)
);

alter table public.knowledge_suggestions enable row level security;
alter table public.entity_relations enable row level security;
alter table public.taxonomy_refinements enable row level security;

create or replace function public.review_knowledge_suggestion(p_suggestion_id uuid, p_approved boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_suggestion public.knowledge_suggestions%rowtype;
  v_entity_id uuid;
  v_source_id uuid;
  v_target_id uuid;
begin
  select * into v_suggestion from public.knowledge_suggestions
  where id = p_suggestion_id and status = 'pending'
  for update;
  if not found then
    raise exception 'suggestion_unavailable';
  end if;

  if not p_approved then
    update public.knowledge_suggestions
    set status = 'rejected', reviewed_at = now(), review_note = p_note
    where id = p_suggestion_id;
    return;
  end if;

  if v_suggestion.suggestion_type = 'discover' then
    v_entity_id := (v_suggestion.proposal->>'entity_id')::uuid;
    update public.entities
    set governance_status = 'homologated', homologated_at = now(), rejected_at = null, updated_at = now()
    where id = v_entity_id and governance_status <> 'consolidated';
    if not found then
      raise exception 'suggestion_entity_missing';
    end if;
    insert into public.entity_governance_events (entity_id, action, actor_id, details)
    values (v_entity_id, 'homologated', null, jsonb_build_object('suggestion_id', p_suggestion_id));
  elsif v_suggestion.suggestion_type = 'group' then
    v_source_id := (v_suggestion.proposal->>'source_entity_id')::uuid;
    v_target_id := (v_suggestion.proposal->>'target_entity_id')::uuid;
    perform public.consolidate_entities(v_source_id, v_target_id, null);
  elsif v_suggestion.suggestion_type = 'relate' then
    v_source_id := (v_suggestion.proposal->>'source_entity_id')::uuid;
    v_target_id := (v_suggestion.proposal->>'target_entity_id')::uuid;
    insert into public.entity_relations (source_entity_id, target_entity_id, evidence_count)
    values (v_source_id, v_target_id, coalesce((v_suggestion.proposal->>'evidence_count')::integer, 0))
    on conflict (source_entity_id, target_entity_id, relation_type)
    do update set evidence_count = greatest(public.entity_relations.evidence_count, excluded.evidence_count);
  elsif v_suggestion.suggestion_type = 'refine' then
    insert into public.taxonomy_refinements (parent_category, proposed_category, rationale, evidence)
    values (
      v_suggestion.proposal->>'parent_category',
      v_suggestion.proposal->>'proposed_category',
      coalesce(v_suggestion.proposal->>'rationale', ''),
      v_suggestion.evidence
    )
    on conflict (parent_category, proposed_category) do nothing;
  else
    raise exception 'unsupported_suggestion';
  end if;

  update public.knowledge_suggestions
  set status = 'approved', reviewed_at = now(), review_note = p_note
  where id = p_suggestion_id;
end;
$$;

revoke all on function public.review_knowledge_suggestion(uuid, boolean, text) from public;
grant execute on function public.review_knowledge_suggestion(uuid, boolean, text) to service_role;
