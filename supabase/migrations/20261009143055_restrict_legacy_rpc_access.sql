-- Supabase default privileges may grant anon/authenticated directly, so revoking
-- only PUBLIC in older migrations did not enforce the intended server-only API.
do $$
declare fn regprocedure;
begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'normalize_entity_name', 'register_entity_evidence', 'persist_validated_perception',
      'consolidate_entities', 'operational_anomalies', 'review_knowledge_suggestion',
      'semantic_neighbors', 'semantic_similar_pairs', 'unembedded_perceptions'
    )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
alter function public.normalize_entity_name(text) set search_path = '';
