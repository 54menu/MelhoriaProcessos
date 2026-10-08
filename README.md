# Inteligência Operacional — POC evolutiva (2, 3, 4, 5)

Prova de conceito sem usuários e sem acessos. Fluxo:

```text
GitHub Pages → Supabase Edge Functions → Gemini → revisão humana → registro
  → Dicionário Evolutivo + Recorrência + Semântica + Evolução Assistida
```

## O que há

- `index.html` + `js/app.js` + `js/api.js`: conversa 5W2H, revisão e registro.
- `admin.html` + `js/admin.js`: dicionário (ponto 2) — candidatos, homologar/rejeitar, sinônimos, consolidar, evidências.
- `analytics.html` + `js/analytics.js`: recorrência exata (ponto 3) — total, top combinações, por sistema/processo, evolução diária.
- `semantic.html` + `js/semantic.js`: semântica (ponto 4) — backfill embeddings, busca, pares, anomalias.
- `evolution.html` + `js/evolution.js`: evolução assistida (ponto 5) — gerar sugestões discover/group/relate/refine como `pending`, aprovar/rejeitar em tela por humano, sem login.
- `supabase/functions/analyze-perception`: conversa com Gemini (5W2H), sem auth, CORS aberto.
- `supabase/functions/record-perception`: valida e registra via `persist_validated_perception` (agora também alimenta dicionário).
- `supabase/functions/dictionary-admin`: list/detail/homologate/reject/add_alias/consolidate, aberto.
- `supabase/functions/operational-analytics`: agregados de `recurrence_summary`/`recurrence_daily`, aberto.
- `supabase/functions/semantic-intelligence`: `backfill`/`search`/`insights` com `gemini-embedding-001` 768 dims, aberto.
- `supabase/functions/knowledge-evolution`: `generate`/`list`/`review` com `poc-evolution.0`, aberto. Sugestões entram como `pending` com `proposal` + `evidence` + `raw_response`; aprovação humana aplica via `review_knowledge_suggestion`.
- Migrations:
  - `20260930000000_poc_baseline.sql`: sessões, percepções, interpretações, classificações, correções.
  - `20261002000000_poc_dictionary.sql`: `entities`, `entity_aliases`, `entity_evidence`, `entity_governance_events`, `register_entity_evidence`, `consolidate_entities`, `dictionary_entity_summary`, persistência estendida.
  - `20261002000001_poc_analytics.sql`: `recurrence_summary`, `recurrence_daily`.
  - `20261002000002_poc_semantic.sql`: `pgvector`, `perception_embeddings`, `unembedded_perceptions`, `semantic_neighbors`, `semantic_similar_pairs`, `operational_anomalies`.
  - `20261003000000_poc_knowledge.sql`: `knowledge_suggestions`, `entity_relations`, `taxonomy_refinements`, `review_knowledge_suggestion` (descobrir/homologar, agrupar/consolidar, relacionar, refinar taxonomia — só após aprovação em tela).
- Sem policies públicas (só `service_role`). Sem `user_roles`, sem `ALLOWED_ORIGIN` restritivo, sem rate-limit.

## Preparação local

1. Preencha `js/config.js` com URL e chave anônima pública do Supabase. A chave do Gemini não vai no frontend.
2. Em um projeto Supabase limpo (ou após `supabase db reset`), aplique em ordem:
   `20260930000000_poc_baseline.sql`, `20261002000000_poc_dictionary.sql`,
   `20261002000001_poc_analytics.sql`, `20261002000002_poc_semantic.sql`,
   `20261003000000_poc_knowledge.sql`.
3. Cadastre os secrets das Edge Functions:
   ```text
   GEMINI_API_KEY=<chave do Gemini>
   ```
   Opcional: `GEMINI_MODEL` (padrão `gemini-3.5-flash-lite`), `GEMINI_EMBEDDING_MODEL` (padrão `gemini-embedding-001`).
4. Publique as 6 functions: `analyze-perception`, `record-perception`, `dictionary-admin`, `operational-analytics`, `semantic-intelligence`, `knowledge-evolution`.
5. Publique a raiz (`index.html`, `admin.html`, `analytics.html`, `semantic.html`, `evolution.html`, `css/`, `js/`) no GitHub Pages.

## Verificação local

Com Node.js 20+: `npm run check`.

## Segurança (escopo POC)

- Modelo aberto, sem autenticação: adequado apenas para demonstração.
- `GEMINI_API_KEY` e `SUPABASE_SERVICE_ROLE_KEY` ficam só nos secrets do Supabase.
- Para evoluir a POC rumo a produção, reintroduzir auth, RLS, CORS restritivo e rate-limit.
