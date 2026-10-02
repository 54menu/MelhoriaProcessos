-- POC evolutivo 4/4: inteligencia semantica com pgvector (sinal, nunca decisao).
-- Embeddings rastreaveis; similaridade e anomalia nao alteram classificacao/dicionario.

create extension if not exists vector with schema extensions;

create table if not exists public.perception_embeddings (
  perception_id uuid primary key references public.perceptions(id) on delete cascade,
  embedding extensions.vector(768) not null,
  embedding_model text not null,
  source_text text not null,
  created_at timestamptz not null default now()
);

alter table public.perception_embeddings enable row level security;

create index if not exists perception_embeddings_embedding_idx
on public.perception_embeddings using ivfflat (embedding extensions.vector_cosine_ops) with (lists = 100);

create or replace function public.unembedded_perceptions(p_limit integer default 20)
returns table (perception_id uuid, original_text text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.original_text
  from public.perceptions p
  left join public.perception_embeddings e on e.perception_id = p.id
  where e.perception_id is null
  order by p.created_at
  limit least(greatest(p_limit, 1), 50)
$$;

create or replace function public.semantic_neighbors(p_embedding extensions.vector(768), p_threshold real default 0.72, p_limit integer default 20)
returns table (perception_id uuid, original_text text, similarity real, created_at timestamptz)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select e.perception_id, p.original_text, (1 - (e.embedding <=> p_embedding))::real as similarity, p.created_at
  from public.perception_embeddings e
  join public.perceptions p on p.id = e.perception_id
  where 1 - (e.embedding <=> p_embedding) >= p_threshold
  order by e.embedding <=> p_embedding
  limit least(greatest(p_limit, 1), 50)
$$;

create or replace function public.semantic_similar_pairs(p_threshold real default 0.84, p_limit integer default 100)
returns table (source_perception_id uuid, target_perception_id uuid, source_text text, target_text text, similarity real)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select a.perception_id, b.perception_id, pa.original_text, pb.original_text, (1 - (a.embedding <=> b.embedding))::real as similarity
  from public.perception_embeddings a
  join public.perception_embeddings b on a.perception_id < b.perception_id
  join public.perceptions pa on pa.id = a.perception_id
  join public.perceptions pb on pb.id = b.perception_id
  where 1 - (a.embedding <=> b.embedding) >= p_threshold
  order by a.embedding <=> b.embedding
  limit least(greatest(p_limit, 1), 200)
$$;

create or replace function public.operational_anomalies()
returns table (sistema text, processo text, categoria_problema text, recent_occurrences integer, prior_daily_average numeric, growth_ratio numeric)
language sql
stable
security definer
set search_path = public
as $$
  with counts as (
    select c.sistema, c.processo, c.categoria_problema,
      count(*) filter (where p.created_at >= now() - interval '7 days')::integer as recent_count,
      count(*) filter (where p.created_at >= now() - interval '37 days' and p.created_at < now() - interval '7 days')::numeric / 30 as prior_daily_average
    from public.classifications c join public.perceptions p on p.id = c.perception_id
    group by c.sistema, c.processo, c.categoria_problema
  )
  select sistema, processo, categoria_problema, recent_count, prior_daily_average,
    case when prior_daily_average = 0 then null else round(recent_count / (prior_daily_average * 7), 2) end
  from counts
  where recent_count >= 2 and (prior_daily_average = 0 or recent_count / greatest(prior_daily_average * 7, 1) >= 2)
  order by recent_count desc
$$;

revoke all on function public.unembedded_perceptions(integer) from public;
revoke all on function public.semantic_neighbors(extensions.vector, real, integer) from public;
revoke all on function public.semantic_similar_pairs(real, integer) from public;
revoke all on function public.operational_anomalies() from public;
grant execute on function public.unembedded_perceptions(integer) to service_role;
grant execute on function public.semantic_neighbors(extensions.vector, real, integer) to service_role;
grant execute on function public.semantic_similar_pairs(real, integer) to service_role;
grant execute on function public.operational_anomalies() to service_role;
