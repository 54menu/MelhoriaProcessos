# Entrega C — revisão humana e indicadores canônicos

Implementada localmente. Nenhum banco remoto foi alterado e nenhuma função foi publicada nesta entrega.

## Comportamento entregue

- Revisão com resumo e seis campos editáveis, rótulos de evidência (informado, inferido, sugerido), situação da identificação, pendências e trechos do relato. Rótulos descrevem a proposta original; alterações humanas ficam separadas na auditoria.
- Identificação obrigatória de quem revisou, explicitamente autodeclarada: a POC continua sem autenticação. Não equivale a identidade verificada.
- A confirmação mantém relato original, proposta da IA, resumo final, classificação final, alterações, data, identificação declarada, versões e contexto de conhecimento. IDs são resolvidos pelo banco; o navegador não os escolhe.
- Resumo final em `classifications.validated_summary`; trilha em `perception_reviews`. O resumo proposto em `ai_interpretations` permanece intacto. Registros antigos não recebem uma revisão retroativa fictícia.
- Valores originais permanecem em `classifications`; quatro colunas de ID e o snapshot da revisão preservam a resolução feita na confirmação. Conceitos novos continuam candidatos, sem homologação automática.
- Reenvio idêntico da confirmação retorna a mesma percepção. Reenvio alterado ou sessão expirada é rejeitado. A operação inteira é transacional.
- Indicadores agrupam nomes e aliases homologados, inclusive registros antigos e entidades consolidadas. Colisões não escolhem uma entidade arbitrária. A governança atual define o agrupamento; o snapshot histórico não é reescrito.
- Totais são calculados antes do limite das listas. API retorna até 50 grupos por lista e 200 datas com registros; painel mostra até 12 itens por gráfico. Datas usam America/Fortaleza.

## Arquivos centrais

- `js/review.mjs`, `js/app.js`, `js/api.js`: revisão e confirmação.
- `supabase/functions/_shared/review-confirmation.mjs` e `record-perception/index.ts`: validação e persistência.
- `supabase/migrations/20261009000001_delivery_c_review_and_canonical.sql`: revisão, resolução e indicadores.
- `supabase/functions/operational-analytics/index.ts`, `js/analytics.js`: consumo dos indicadores canônicos.
- `tests/review-delivery.test.mjs`: testes da entrega.

Migração criada com `supabase migration new`; identificador ajustado para ordenar depois da migração de produto existente. Aplicar migrações pendentes em ordem, sem reinicializar banco com dados.

## Validação local

`npm run check`: **54 testes passaram**, incluindo 12 novos da entrega C.

Os testes executam o SQL em PostgreSQL isolado via PGlite, incluindo instalação limpa e atualização com registro legado. Cobrem resolução de aliases, consolidação, colisões, correções humanas, preservação de originais, versões, repetição idempotente, sessão expirada, rollback completo, permissões, RLS e totais com 65 combinações.

O teste de interface usa DOM via linkedom: verifica inferências, citação tratada como texto (sem executar HTML), exigência de identificação, envio de ajustes, bloqueio de envio duplicado e recuperação após falha. Também há testes do handler HTTP com persistência controlada.

Limites: a migração semântica de pgvector é excluída somente do ambiente PGlite; as demais migrações são executadas sem adaptação. Não houve teste de pgvector, renderização visual em navegador real, runtime Deno, Gemini real ou ambiente Supabase remoto. A precisão do classificador não é medida por estes testes. Consultas usam índices de nomes/aliases e agrupamento materializado dentro da consulta, mas desempenho em volume de produção ainda precisa de medição.

## Sequência de publicação e teste integrado

1. Conferir migrações já aplicadas no ambiente de destino e aplicar a migração C depois de produto.
2. Publicar `record-perception` com `_shared` e `operational-analytics`; manter a entrega B de `analyze-perception` disponível.
3. Publicar frontend, incluindo `js/review.mjs`, `js/api.js`, `js/app.js`, `js/analytics.js`, `analytics.html` e CSS. Frontend e função de confirmação devem ser publicados de forma coordenada: resumo e identificação agora são obrigatórios.
4. Criar uma análise contendo alias homologado, conferir trechos, alterar resumo/campo e confirmar. Verificar original, proposta, revisão, versões e ID canônico.
5. Repetir a mesma requisição e verificar que não há duplicação. Testar falha recuperável e sessão expirada.
6. Confirmar conceito novo e conferir que permanece candidato. Verificar agrupamento de alias e consolidação nos indicadores.

A publicação e esse teste integrado permanecem pendentes. A entrega seguinte não foi iniciada.
