-- POC enxuto: relato + IA + registro, sem usuários/acessos.
-- pressupõe banco limpo (supabase db reset em projeto novo).
-- As Edge Functions usam service_role e o frontend fala apenas com elas;
-- nenhuma tabela precisa de policy pública.

create table if not exists public.analysis_sessions (
  id uuid primary key default gen_random_uuid(),
  original_text text not null check (char_length(original_text) between 1 and 2000),
  prompt_version text not null,
  model text not null,
  raw_response jsonb not null,
  proposed_interpretation jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  consumed_at timestamptz
);

create index if not exists analysis_sessions_expiry_idx on public.analysis_sessions (expires_at) where consumed_at is null;

create table if not exists public.perceptions (
  id uuid primary key default gen_random_uuid(),
  original_text text not null check (char_length(original_text) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table if not exists public.ai_interpretations (
  id uuid primary key default gen_random_uuid(),
  perception_id uuid not null references public.perceptions(id) on delete restrict,
  prompt_version text not null,
  raw_response jsonb not null,
  interpretation text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.classifications (
  id uuid primary key default gen_random_uuid(),
  perception_id uuid not null unique references public.perceptions(id) on delete restrict,
  tipo text not null check (tipo in ('reclamacao', 'sugestao', 'duvida', 'elogio', 'outro')),
  processo text,
  subprocesso text,
  sistema text,
  categoria_problema text not null check (categoria_problema in ('erro', 'lentidao', 'acesso', 'usabilidade', 'integracao', 'processo', 'informacao', 'outro')),
  validated_at timestamptz not null default now()
);

create table if not exists public.corrections (
  id uuid primary key default gen_random_uuid(),
  perception_id uuid not null references public.perceptions(id) on delete restrict,
  field text not null check (field in ('tipo', 'processo', 'subprocesso', 'sistema', 'categoria_problema')),
  ai_value text,
  final_value text,
  created_at timestamptz not null default now()
);

alter table public.analysis_sessions enable row level security;
alter table public.perceptions enable row level security;
alter table public.ai_interpretations enable row level security;
alter table public.classifications enable row level security;
alter table public.corrections enable row level security;

-- Sem policies: acesso direto bloqueado; somente service_role (Edge Functions) grava/lê.

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

  update public.analysis_sessions set consumed_at = now() where id = p_session_id;
  return v_perception_id;
end;
$$;

revoke all on function public.persist_validated_perception(uuid, jsonb) from public;
grant execute on function public.persist_validated_perception(uuid, jsonb) to service_role;
