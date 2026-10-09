# Publicação das entregas A–D

Data: 09/10/2026. Publicação autorizada pelo usuário nesta tarefa.

- Projeto Supabase: `ghseibnjwiqsjmhtpgiy`.
- Repositório: `fvclares/MelhoriaProcessos`, branch `main`.
- Migração C e correção de permissões legadas aplicadas, sem reinicializar banco.
- Funções atualizadas: `analyze-perception`, `record-perception`, `operational-analytics`, `knowledge-evolution`. Verificação JWT preservada.
- Testes locais: 60 passaram. CI atualizado para instalar dependências antes de executar a suíte.
- Testes HTTP iniciais: indicadores 200 com total 5, confirmação incompleta 400, análise 200 com contrato `classification.1` e modelo `gemini-3.5-flash-lite`.
- Cinco percepções e cinco classificações existentes preservadas; nenhuma revisão retroativa inventada.

O verificador remoto identificou permissões diretas de `anon`/`authenticated` em rotinas legadas, apesar da revogação de PUBLIC nas migrações antigas. A migração `20261009143055_restrict_legacy_rpc_access.sql` revoga essas permissões e mantém execução pelo servidor. Também fixa o `search_path` da normalização. [Orientação do Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

A comparação real terminou com 20 casos sintéticos de desenvolvimento por modelo, sem gravação de percepções. A função temporária protegida por JWT, token aleatório e expiração usou a chave Gemini já configurada no Supabase. A chave não foi devolvida nem copiada. A função temporária foi removida, com ausência confirmada na listagem remota.

## Resultado observado

| Medida | Gemini 3.5 Flash-Lite | Gemini 3.8 Flash |
| --- | --- | --- |
| Análises com contrato válido | 20/20 | 0/20 |
| Categoria conforme gabarito proposto | 17/20 (85%) | Não avaliável semanticamente: falhas de chamada |
| Tipo conforme gabarito proposto | 20/20 | Não avaliável semanticamente |
| Encaminhamento correto | 16/20 | Não avaliável semanticamente |
| Perguntas desnecessárias | 4 | Não avaliável semanticamente |
| Liberações precoces detectadas | 0 | Não avaliável semanticamente |
| Latência média por análise, incluindo falhas | 6,04 s | 18,02 s |
| p95 | 9,88 s | 30,28 s |
| Tentativas ao provedor | 24 | 40 |

O candidato registrou 17 respostas 429 (limite/quota), 3 respostas 503, 13 timeouts 504 do transporte e 7 tentativas sem resposta HTTP observada. Esse resultado mede indisponibilidade nas condições desta execução, não inferioridade semântica do modelo. O transporte temporário tinha limite de 14 s no servidor e 15 s no cliente por tentativa. O modelo atual teve 23 respostas HTTP 200 e uma tentativa sem resposta observada; algumas respostas exigiram correção de contrato antes da aceitação.

Decisão: manter `gemini-3.5-flash-lite`; não promover o candidato. A base proposta ainda não foi revisada por especialista, a categoria do modelo atual ficou abaixo do alvo proposto de 90%, e a comparação de qualidade com o candidato foi inconclusiva. Não há aprovação para autonomia adicional. Custos financeiros permanecem nulos, sem inventar cobranças a partir de uso parcial. [Relatório reproduzível](../evals/delivery-d-results.json).

## Verificação da publicação

- Commit de implementação: `ed191a5`.
- [Quality gate aprovado](https://github.com/fvclares/MelhoriaProcessos/actions/runs/37945111577).
- [GitHub Pages publicado](https://github.com/fvclares/MelhoriaProcessos/actions/runs/37945110665).
- [Site](https://fvclares.github.io/MelhoriaProcessos/): interface de revisão, exibição de trechos e indicadores conferidos no navegador real.
- Persistência testada no banco remoto com o papel `service_role`, revisão e repetição idempotente dentro de transação revertida; cinco percepções originais preservadas.
- Verificador remoto após a correção: nenhum WARN/ERROR de segurança; apenas 14 avisos INFO de RLS sem policies, esperados para acesso exclusivo pelo servidor. [Descrição desse aviso](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- Publicadas versões 31 de análise e 16 de confirmação, indicadores e evolução. JWT mantido em todas.

O modelo operacional permanece o anterior. Gabaritos de domínio, revisão semântica e piloto supervisionado ainda são necessários antes de concluir seleção ou ampliar autonomia.
