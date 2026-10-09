create table public.correction_curations (
  id uuid primary key default gen_random_uuid(),
  perception_id uuid not null unique references public.perception_reviews(perception_id),
  status text not null default 'pending' check(status in ('pending','approved','rejected','active','retired')),
  example_text text check(char_length(trim(example_text)) between 1 and 2000),
  classification jsonb,
  taxonomy_version text not null default 'operational-taxonomy.1',
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
create index correction_curations_status_idx on public.correction_curations(status,created_at,id);
create table public.example_catalog_state (
  id boolean primary key default true check(id), revision bigint not null default 0
);
insert into public.example_catalog_state default values;
create table public.example_catalog_events (
  id uuid primary key default gen_random_uuid(),
  curation_id uuid references public.correction_curations(id),
  action text not null check(action in ('approved','rejected','published','retired')),
  actor_label text not null check(char_length(trim(actor_label)) between 1 and 120),
  actor_verification text not null default 'self_declared' check(actor_verification='self_declared'),
  details jsonb not null,
  created_at timestamptz not null default now()
);
create index example_catalog_events_curation_idx on public.example_catalog_events(curation_id);
alter table public.correction_curations enable row level security;
alter table public.example_catalog_state enable row level security;
alter table public.example_catalog_events enable row level security;
revoke all on public.correction_curations,public.example_catalog_state,public.example_catalog_events from public,anon,authenticated;
grant select,insert,update on public.correction_curations,public.example_catalog_state to service_role;
grant select,insert on public.example_catalog_events to service_role;

create function public.enqueue_correction_curation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.changes <> '{}'::jsonb then
    insert into public.correction_curations(perception_id) values(new.perception_id) on conflict(perception_id) do nothing;
  end if;
  return new;
end $$;
create trigger enqueue_correction_curation after insert on public.perception_reviews
for each row execute function public.enqueue_correction_curation();
insert into public.correction_curations(perception_id)
select perception_id from public.perception_reviews where changes <> '{}'::jsonb on conflict do nothing;

create function public.curated_example_catalog(p_include_approved boolean default false) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('version','curated.'||s.revision,'examples',coalesce((
    select jsonb_agg(jsonb_build_object('id',c.id,'status','approved','text',c.example_text,
      'classification',c.classification,'taxonomy_version',c.taxonomy_version,
      'reviewed_by',c.reviewed_by,'reviewed_at',c.reviewed_at) order by c.id)
    from public.correction_curations c where c.status='active' or (p_include_approved and c.status='approved')
  ),'[]'::jsonb)) from public.example_catalog_state s where s.id
$$;

create function public.curated_example_snapshot() returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('base_revision',s.revision,'baseline',public.curated_example_catalog(false),
    'candidate',public.curated_example_catalog(true),
    'candidate_fingerprint',md5((public.curated_example_catalog(true)->'examples')::text))
  from public.example_catalog_state s where s.id
$$;

create function public.review_correction_example(p_id uuid,p_approved boolean,p_text text,p_classification jsonb,p_actor text,p_note text)
returns void language plpgsql security invoker set search_path='' as $$
declare c public.correction_curations%rowtype; f text;
begin
  if p_actor is null or char_length(trim(p_actor)) not between 1 and 120 or p_note is null or char_length(trim(p_note)) not between 1 and 1000 or p_approved is null then raise exception 'invalid_review'; end if;
  perform 1 from public.example_catalog_state where id for update;
  select * into c from public.correction_curations where id=p_id for update;
  if not found or c.status <> 'pending' then raise exception 'curation_unavailable'; end if;
  if p_approved then
    if p_text is null or char_length(trim(p_text)) not between 1 and 2000 or jsonb_typeof(p_classification) is distinct from 'object' then raise exception 'invalid_example'; end if;
    if (select count(*) from jsonb_object_keys(p_classification))<>6 or not p_classification ?& array['tipo','processo','subprocesso','sistema','produto','categoria_problema'] then raise exception 'invalid_example'; end if;
    foreach f in array array['tipo','processo','subprocesso','sistema','produto','categoria_problema'] loop
      if jsonb_typeof(p_classification->f) not in ('null','string') or (p_classification->>f is not null and char_length(trim(p_classification->>f)) not between 1 and 160) then raise exception 'invalid_example'; end if;
    end loop;
    if p_classification->>'tipo' is null or p_classification->>'tipo' not in ('reclamacao','sugestao','duvida','elogio','outro') or p_classification->>'categoria_problema' is null or p_classification->>'categoria_problema' not in ('erro','lentidao','acesso','usabilidade','integracao','processo','informacao','outro') then raise exception 'invalid_example'; end if;
    if exists(select 1 from public.correction_curations where status in ('approved','active') and lower(trim(example_text))=lower(trim(p_text))) then raise exception 'duplicate_example_text'; end if;
  end if;
  update public.correction_curations set status=case when p_approved then 'approved' else 'rejected' end,
    example_text=case when p_approved then trim(p_text) end,classification=case when p_approved then p_classification end,
    reviewed_by=trim(p_actor),reviewed_at=now(),review_note=trim(p_note) where id=p_id;
  insert into public.example_catalog_events(curation_id,action,actor_label,details)
    values(p_id,case when p_approved then 'approved' else 'rejected' end,trim(p_actor),jsonb_build_object('note',trim(p_note),'text',case when p_approved then trim(p_text) end,'classification',case when p_approved then p_classification end));
end $$;

create function public.publish_curated_examples(p_base_revision bigint,p_fingerprint text,p_actor text,p_regression jsonb)
returns bigint language plpgsql security invoker set search_path='' as $$
declare rev bigint; affected integer;
begin
  if p_actor is null or char_length(trim(p_actor)) not between 1 and 120 then raise exception 'invalid_review'; end if;
  select revision into rev from public.example_catalog_state where id for update;
  if rev is distinct from p_base_revision or p_fingerprint is distinct from md5((public.curated_example_catalog(true)->'examples')::text) then raise exception 'stale_catalog'; end if;
  -- The Edge handler independently validates paired metrics and hashes. This
  -- durable record is a curator declaration, not an authenticated identity.
  if jsonb_typeof(p_regression) is distinct from 'object' or p_regression->>'status' is distinct from 'passed'
    or p_regression->>'candidate_fingerprint' is distinct from p_fingerprint
    or coalesce(length(p_regression->>'report_sha256'),0)<>64
    or coalesce(length(trim(p_regression->>'reference')),0)=0 then raise exception 'regression_required'; end if;
  if (select count(*) from public.correction_curations where status in ('approved','active'))>500 then raise exception 'catalog_capacity_exceeded'; end if;
  update public.correction_curations set status='active' where status='approved';
  get diagnostics affected=row_count;
  if affected=0 then raise exception 'no_approved_examples'; end if;
  update public.example_catalog_state set revision=revision+1 where id returning revision into rev;
  insert into public.example_catalog_events(action,actor_label,details) values('published',trim(p_actor),jsonb_build_object('revision',rev,'examples',affected,'regression',p_regression));
  return rev;
end $$;

create function public.retire_curated_example(p_id uuid,p_actor text,p_note text) returns bigint
language plpgsql security invoker set search_path='' as $$
declare rev bigint;
begin
  if p_actor is null or char_length(trim(p_actor)) not between 1 and 120 or p_note is null or char_length(trim(p_note)) not between 1 and 1000 then raise exception 'invalid_review'; end if;
  perform 1 from public.example_catalog_state where id for update;
  update public.correction_curations set status='retired' where id=p_id and status in ('approved','active');
  if not found then raise exception 'curation_unavailable'; end if;
  update public.example_catalog_state set revision=revision+1 where id returning revision into rev;
  insert into public.example_catalog_events(curation_id,action,actor_label,details) values(p_id,'retired',trim(p_actor),jsonb_build_object('revision',rev,'note',trim(p_note)));
  return rev;
end $$;

revoke all on function public.enqueue_correction_curation(),public.curated_example_catalog(boolean),public.curated_example_snapshot(),public.review_correction_example(uuid,boolean,text,jsonb,text,text),public.publish_curated_examples(bigint,text,text,jsonb),public.retire_curated_example(uuid,text,text) from public,anon,authenticated;
grant execute on function public.enqueue_correction_curation(),public.curated_example_catalog(boolean),public.curated_example_snapshot(),public.review_correction_example(uuid,boolean,text,jsonb,text,text),public.publish_curated_examples(bigint,text,text,jsonb),public.retire_curated_example(uuid,text,text) to service_role;
