-- POC evolutivo 3/4: inteligencia de recorrencia (contagens exatas, sem semantica).
-- Views leem classifications + perceptions; Edge usa service_role (bypassa RLS).

create or replace view public.recurrence_summary
with (security_invoker = true)
as
select
  c.sistema,
  c.processo,
  c.subprocesso,
  c.categoria_problema,
  count(*)::integer as occurrences,
  min(p.created_at) as first_seen_at,
  max(p.created_at) as last_seen_at
from public.classifications c
join public.perceptions p on p.id = c.perception_id
group by c.sistema, c.processo, c.subprocesso, c.categoria_problema;

create or replace view public.recurrence_daily
with (security_invoker = true)
as
select
  date_trunc('day', p.created_at)::date as occurrence_date,
  c.sistema,
  c.processo,
  c.categoria_problema,
  count(*)::integer as occurrences
from public.classifications c
join public.perceptions p on p.id = c.perception_id
group by date_trunc('day', p.created_at)::date, c.sistema, c.processo, c.categoria_problema;
