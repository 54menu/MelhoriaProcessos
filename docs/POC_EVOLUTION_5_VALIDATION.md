# Validação — ponto evolutivo 5 / MVP 5 (POC aberta, sem login)

Modelo: sem e-mail/senha. A validação é feita por humano na tela `evolution.html`
(Aprovar/Rejeitar). A IA só sugere como `pending`; o sistema só aplica após decisão humana.

## Roteiro

1. Tenha dicionário com candidatos (`admin.html`) e alguma recorrência (`analytics.html`).
2. Em `evolution.html`, clique **Gerar sugestões** → resposta `created` > 0 na primeira leva.
   Confira em `knowledge_suggestions`: `status=pending`, `proposal`, `evidence`,
   `raw_response` e `prompt_version=poc-evolution.0` preenchidos. Nada no dicionário muda aqui.
3. Clique **Atualizar lista** → sugestões aparecem como `discover|group|relate|refine · pending`.
4. Aprove um `discover` → entidade indicada vira `homologated` + evento
   `homologated` em `entity_governance_events` com `details.suggestion_id`.
5. Aprove um `group` (mesmo `entity_type`) → origem vira `consolidated`,
   evidências migram para o destino, nome da origem vira alias do destino.
6. Aprove um `relate` → linha em `entity_relations` entre as duas entidades.
7. Aprove um `refine` → linha em `taxonomy_refinements`; registros antigos
   **não** são reclassificados.
8. Rejeite uma sugestão `pending` → `status=rejected` + `reviewed_at`, sem alterar
   entidades, relações ou taxonomia.
9. Gere novamente → sugestões idênticas não duplicam (`fingerprint` único;
   segunda leva retorna `created=0` para as mesmas propostas).
10. Revise sugestão já decidida → `409 suggestion_unavailable`.

## Gate

Sugestões nascem `pending` com origem rastreável, entram sem alterar o domínio,
só provocam alteração após Aprovar em tela, rejeição preserva o domínio,
idempotência por `fingerprint`, sem auto-decisão e sem login (POC).
