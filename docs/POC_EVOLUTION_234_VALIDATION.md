# Validação — pontos evolutivos 2, 3, 4 (POC aberta)

## 2 — Dicionário
1. Confirme percepção com sistema/processo novo → aparece em `admin.html` como `candidate`.
2. Detalhe → mostra `entity_aliases` + `entity_evidence` (campo, `observed|inferred|suggested`).
3. Homologue → `governance_status=homologated` + evento em `entity_governance_events`.
4. Adicione sinônimo → vinculado; novo relato com variação usa mesma entidade via `register_entity_evidence`.
5. Consolide A→B mesmo tipo → evidências migram, A=`consolidated`, nome vira alias de B.
6. Rejeite → `rejected` + evento.

## 3 — Recorrência (exata)
- Total = `count(classifications)`; combinação repetida sistema/processo/subprocesso/categoria aparece em recorrentes; somas por sistema/processo batem; evolução diária bate `perceptions.created_at`; sem unidade (mensagem explícita); sem inferência semântica.

## 4 — Semântica (sinal)
1. `backfill` até zerar `unembedded_perceptions`; `perception_embeddings` com `embedding_model` + `source_text`.
2. Busque “GRAN travou na inclusão” → equivalentes com palavras diferentes retornam similaridade alta via `semantic_neighbors`.
3. Pares (`semantic_similar_pairs`) são candidatos, não consolidam; anomalias (`operational_anomalies` 7d vs 30d) indicam variação, não causa.
4. Texto/classificação/dicionário inalterados pelo embedding.

Gate: candidatos nascem de confirmação, governança registrada, indicadores reproduzem validados, embeddings rastreáveis, sem auto-decisão.
