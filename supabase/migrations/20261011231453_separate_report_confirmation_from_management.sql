create table public.report_submissions (
  analysis_session_id uuid primary key references public.analysis_sessions(id),
  submitted_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','reviewed')),
  perception_id uuid unique references public.perceptions(id),
  reviewed_at timestamptz,
  check ((status='pending' and perception_id is null and reviewed_at is null)
    or (status='reviewed' and perception_id is not null and reviewed_at is not null))
);
create index report_submissions_pending_idx on public.report_submissions(submitted_at,analysis_session_id) where status='pending';
alter table public.report_submissions enable row level security;
revoke all on public.report_submissions from public,anon,authenticated;
grant select,insert,update on public.report_submissions to service_role;

create function public.submit_confirmed_report(p_session_id uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare s public.analysis_sessions%rowtype;
begin
  select * into s from public.analysis_sessions where id=p_session_id for update;
  if not found then raise exception 'analysis_session_unavailable'; end if;
  -- Repeated acknowledgement never creates a second item or approves it.
  if exists(select 1 from public.report_submissions where analysis_session_id=p_session_id) then return p_session_id; end if;
  if s.consumed_at is not null or s.expires_at<=now()
    or nullif(trim(s.proposed_interpretation->>'interpretation'),'') is null
    or jsonb_typeof(s.proposed_interpretation->'fields') is distinct from 'object' then
    raise exception 'analysis_session_unavailable';
  end if;
  insert into public.report_submissions(analysis_session_id) values(p_session_id);
  return p_session_id;
end
$$;

create function public.review_submitted_report(p_session_id uuid,p_classification jsonb,p_summary text,p_reviewer_label text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare submission public.report_submissions%rowtype; result_id uuid; original_expiry timestamptz;
begin
  select * into submission from public.report_submissions where analysis_session_id=p_session_id for update;
  if not found then raise exception 'report_not_submitted'; end if;
  select expires_at into original_expiry from public.analysis_sessions where id=p_session_id for update;
  -- Once submitted, review is asynchronous and is not limited by the chat TTL.
  -- The original expiry is restored in this same transaction for audit accuracy.
  if submission.status='pending' then
    update public.analysis_sessions set expires_at=greatest(expires_at,now()+interval '1 minute') where id=p_session_id;
  end if;
  result_id:=public.persist_reviewed_perception(p_session_id,p_classification,p_summary,p_reviewer_label);
  update public.analysis_sessions set expires_at=original_expiry where id=p_session_id;
  update public.report_submissions set status='reviewed',perception_id=result_id,reviewed_at=coalesce(reviewed_at,now()) where analysis_session_id=p_session_id;
  return result_id;
end
$$;
revoke all on function public.submit_confirmed_report(uuid),public.review_submitted_report(uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.submit_confirmed_report(uuid),public.review_submitted_report(uuid,jsonb,text,text) to service_role;
