-- Delivery F: supervised routing only. No automatic-recording switch exists.
create table public.review_policy_revisions (
  revision bigint generated always as identity primary key,
  version text not null default 'selective-review.1' check (version = 'selective-review.1'),
  simplified_review_enabled boolean not null,
  actor_label text not null check (char_length(trim(actor_label)) between 1 and 120),
  note text not null check (char_length(trim(note)) between 1 and 500),
  created_at timestamptz not null default now()
);
insert into public.review_policy_revisions(simplified_review_enabled,actor_label,note)
values(true,'Entrega F','Confirmação humana obrigatória; simplificação apenas de casos explícitos e resolvidos.');
alter table public.review_policy_revisions enable row level security;
revoke all on public.review_policy_revisions from public, anon, authenticated;
grant select, insert on public.review_policy_revisions to service_role;
grant usage, select on sequence public.review_policy_revisions_revision_seq to service_role;

create function public.current_review_policy() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('version',version,'revision',revision,'simplified_review_enabled',simplified_review_enabled)
  from public.review_policy_revisions order by revision desc limit 1
$$;
-- Restricted administrative RPC. No public Edge endpoint exposes this mutation.
create function public.set_review_simplification(p_enabled boolean, p_actor text, p_note text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare next_revision bigint;
begin
  if p_enabled is null or p_actor is null or p_note is null then raise exception 'invalid_policy_change'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('review-policy',0));
  insert into public.review_policy_revisions(simplified_review_enabled,actor_label,note)
    values(p_enabled,trim(p_actor),trim(p_note)) returning revision into next_revision;
  return public.current_review_policy();
end
$$;

create table public.classification_analysis_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  analysis_session_id uuid unique references public.analysis_sessions(id),
  model text not null check (char_length(model) between 1 and 160),
  prompt_version text,
  status text not null check (status in ('succeeded','failed')),
  error_code text,
  action text check (action in ('clarify','simple_confirmation','detailed_review')),
  policy_version text,
  policy_revision bigint references public.review_policy_revisions(revision),
  simple_candidate boolean not null default false,
  attention_fields jsonb not null default '[]' check (jsonb_typeof(attention_fields) = 'array'),
  reasons jsonb not null default '[]' check (jsonb_typeof(reasons) = 'array'),
  category text,
  examples_version text,
  dictionary_sha256 text,
  user_turns integer not null check (user_turns between 1 and 6),
  elapsed_ms integer not null check (elapsed_ms >= 0),
  check ((status='succeeded' and action is not null and policy_revision is not null and error_code is null)
    or (status='failed' and action is null and error_code is not null))
);
create index classification_events_created_idx on public.classification_analysis_events(created_at);
create index classification_events_policy_idx on public.classification_analysis_events(policy_revision);
alter table public.classification_analysis_events enable row level security;
revoke all on public.classification_analysis_events from public, anon, authenticated;
grant select, insert on public.classification_analysis_events to service_role;

create function public.classification_monitoring(p_days integer default 30) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare report jsonb;
begin
  if p_days is null or p_days not in (7,30,90) then raise exception 'invalid_monitoring_window'; end if;
  with events as materialized (
    select e.*, r.perception_id, r.changes,
      extract(epoch from (r.reviewed_at-s.created_at))*1000 as review_elapsed_ms
    from public.classification_analysis_events e
    left join public.perception_reviews r on r.analysis_session_id=e.analysis_session_id
    left join public.analysis_sessions s on s.id=e.analysis_session_id
    where e.created_at >= now() - pg_catalog.make_interval(days=>p_days)
  ), totals as (
    select count(*) as attempts, count(*) filter(where status='failed') as failures,
      count(*) filter(where status='succeeded') as succeeded,
      count(*) filter(where action='clarify') as clarification_requests,
      count(*) filter(where action='simple_confirmation') as simple_confirmations,
      count(*) filter(where action='detailed_review') as detailed_reviews,
      count(*) filter(where simple_candidate) as simple_candidates,
      count(perception_id) as confirmed,
      count(*) filter(where changes <> '{}'::jsonb) as corrected,
      avg(elapsed_ms) as average_analysis_ms,
      percentile_cont(0.95) within group(order by elapsed_ms) as p95_analysis_ms,
      avg(user_turns) filter(where perception_id is not null) as average_turns_confirmed,
      avg(review_elapsed_ms) filter(where perception_id is not null) as average_elapsed_until_confirmation_ms
    from events
  ), groups as (
    select model,prompt_version,policy_revision,category,action,examples_version,dictionary_sha256,
      count(*) as attempts, count(*) filter(where status='failed') as failures,
      count(perception_id) as confirmed, count(*) filter(where changes<>'{}'::jsonb) as corrected
    from events group by model,prompt_version,policy_revision,category,action,examples_version,dictionary_sha256
  ), fields as (
    select key as field, count(*) as corrections from events
    cross join lateral jsonb_object_keys(coalesce(changes,'{}'::jsonb)) as key group by key
  )
  select jsonb_build_object(
    'window_days',p_days,'generated_at',now(),'policy',public.current_review_policy(),
    'automatic_recording_allowed',false,
    'totals',(select to_jsonb(t) from totals t),
    'groups',coalesce((select jsonb_agg(to_jsonb(g) order by model,policy_revision,category,action,examples_version) from groups g),'[]'::jsonb),
    'field_corrections',coalesce((select jsonb_agg(to_jsonb(f) order by field) from fields f),'[]'::jsonb),
    'alerts',jsonb_build_object(
      'failure_rate_exceeded',(select attempts>=20 and failures::numeric/nullif(attempts,0)>0.10 from totals),
      'correction_rate_exceeded',(select confirmed>=20 and corrected::numeric/nullif(confirmed,0)>0.10 from totals)),
    'cost',null,
    'limitations',jsonb_build_array('human_confirmation_required','domain_accuracy_not_measured','self_declared_reviewers','only_instrumented_attempts','review_elapsed_is_not_active_work_time','cost_not_measured')
  ) into report;
  return report;
end
$$;

revoke all on function public.current_review_policy(),public.set_review_simplification(boolean,text,text),public.classification_monitoring(integer) from public,anon,authenticated;
grant execute on function public.current_review_policy(),public.set_review_simplification(boolean,text,text),public.classification_monitoring(integer) to service_role;
