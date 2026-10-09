# Entrega E — melhoria contínua por exemplos revisados

## Fluxo implementado

Correção confirmada → fila pendente → curador generaliza o relato e confere os seis campos → aprovação para avaliação → comparação de regressão → publicação → recuperação nos próximos relatos pertinentes.

- A inserção em `perception_reviews` com alterações cria uma única entrada em `correction_curations`, na mesma transação. Revisões existentes com alterações são incluídas pela migração. Confirmações sem mudanças não criam exemplos artificiais; correções antigas sem a trilha da entrega C não são promovidas retroativamente.
- A nova tela `curation.html`, acessível pela página Evolução, mostra relato de origem, alterações e editor. Curador informa nome e justificativa; o texto deve ser generalizado e ter dados pessoais removidos antes da aprovação. Aprovar não publica, homologa entidade ou altera taxonomia.
- Rejeitados nunca alimentam o classificador. Exemplos aprovados aguardam avaliação. Somente `active` entram no catálogo consultado pela análise. Recuperação lexical e limite de quatro exemplos por relato continuam iguais à entrega B.
- Publicação gera nova revisão de catálogo e evento com responsável, fingerprint, hash do relatório e referência da avaliação. Uma mudança concorrente no catálogo impede publicar uma avaliação obsoleta. Até 500 exemplos ativos/aprovados por catálogo nesta POC.
- Retirar um exemplo mantém texto, classificação e eventos históricos, mas o remove das próximas recuperações. Análises já iniciadas preservam o snapshot utilizado; sessões anteriores não são reescritas.
- Falha ao consultar o catálogo interrompe a análise, evitando uso silencioso de referências antigas. Não há cache permanente que retenha exemplos retirados.

## Como avaliar e publicar

1. Revisar propostas e aprovar somente exemplos adequados para reutilização.
2. Exportar os catálogos atual/candidato e o snapshot completo do dicionário pela tela.
3. Preparar base separada de referência com `{ "version": "...", "cases": [...] }` no formato da entrega A. Gabaritos aprovados exigem `review_status: approved`, `reviewed_by` e `reviewed_at`. Exemplos usados para ensinar não podem coincidir com os relatos de avaliação. A revisão dos gabaritos sintéticos atuais continua pendente.
4. Planejar sem chamar APIs:

```text
npm run eval:knowledge -- --snapshot caminho/catalogue-for-evaluation.json --dataset caminho/base-revisada.json
```

5. Acrescentar `--execute --output-dir .test-artifacts/avaliacao-e` para executar. A pasta de destino deve ser nova. Usar chave no ambiente ou `--relay-config` para o mesmo transporte temporário autenticado da entrega D, mantendo a chave no Supabase. Nenhuma função de avaliação pública permanente é criada por esta entrega. `--model` precisa corresponder ao modelo de classificação em operação; `--split dev|test` seleciona o conjunto. Máximo de 100 casos e quatro tentativas por caso (dois catálogos, até duas por catálogo).
6. Conferir `responses.json` e preencher os campos de `human_review` no relatório gerado: responsável, data, ausência de invenções e regressões semânticas, referência do registro de avaliação. Não preencher essas declarações sem revisão real.
7. Enviar `regression-report.json` na tela e publicar. O servidor verifica hashes dos catálogos e do dicionário atual, modelo, prompt, contrato e taxonomia; base igual e totalmente revisada; ausência de falhas do candidato; nenhum novo erro por caso/campo ou regressão de encaminhamento; nenhuma liberação precoce e nenhum aumento de perguntas desnecessárias. A avaliação compara o mesmo modelo com os dois catálogos, sem criar sessões ou percepções.

O relatório é uma **declaração do curador com métricas verificadas estruturalmente**, não um documento assinado ou prova independente de execução. A POC não autentica o curador. Este controle não substitui identidade verificada, revisão de domínio, amostra representativa ou políticas de acesso do piloto.

## Escopo do conhecimento

Esta entrega fecha o ciclo de reutilização de correções como exemplos. Aliases, homologações, relações e propostas de taxonomia continuam no Dicionário e na Evolução, com seus fluxos existentes; não são inferidos nem aplicados a partir de uma correção individual. Publicar um exemplo não altera as categorias aceitas pelo contrato. Integração automática dessas outras formas de conhecimento e autenticação operacional não fazem parte desta alteração.

## Verificação

`npm run check`: **71 testes passaram**, incluindo onze novos de curadoria e integração com o classificador. SQL executado em PostgreSQL isolado via PGlite; DOM testado com linkedom. Cobertura de fila, idempotência, rejeição, duplicidade, aprovação separada de publicação, avaliação obrigatória, catálogo obsoleto, retirada, permissões, recuperação e interface. A suíte mantém os testes das entregas A–D.

Não foram aprovadas correções reais nem fabricados resultados para liberar exemplos. A melhora semântica nos dados da organização exige curadoria e avaliação reais; os testes técnicos não a comprovam. Migração: `20261009200350_delivery_e_curated_examples.sql`. Funções a publicar: `knowledge-curation` e `analyze-perception`, com JWT habilitado.

## Publicação autorizada

Migração e duas funções publicadas no Supabase em 09/10/2026. Testes HTTP: listagem 200, exportação 200 e tentativa de publicação sem avaliação 400. Catálogo inicial `curated.0`, sem exemplos ativos e sem propostas pendentes no momento da verificação. Planejamento do executor testado com o snapshot real, sem chamar o modelo.

Teste transacional remoto com `service_role`: confirmação gera proposta; aprovação inclui no candidato, mas não no catálogo ativo; retirada funciona. A transação foi revertida ao final, preservando cinco percepções, zero propostas e catálogo `curated.0`.

O verificador de segurança retornou apenas 17 avisos informativos de RLS sem policies, coerentes com acesso às tabelas exclusivamente pelo servidor; nenhum WARN/ERROR. [Descrição do aviso](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

Verificação integrada após republicação: `analyze-perception` respondeu 200, com contrato válido e catálogo `curated.0` completo. Uma tentativa anterior retornou `knowledge_unavailable`; a causa não foi confirmada. O carregador registra somente o código do erro de catálogo para facilitar diagnóstico, sem conteúdo de relatos ou credenciais. A tela publicada foi inspecionada no navegador e carregou a fila vazia e os controles de avaliação. Quality gate e publicação do GitHub Pages concluíram com sucesso.
