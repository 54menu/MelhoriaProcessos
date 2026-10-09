# Contrato de classificação 1 — preparado na entrega A

Versão: `classification.1`. Taxonomia: `operational-taxonomy.1`. Estado: integrado ao código na entrega B; publicação remota ainda não realizada.

Fonte executável: `supabase/functions/_shared/classification-contract.mjs`, reexportada por `lib/classification-contract.mjs` para avaliação Node. Exportação JSON Schema: `node scripts/export-classification-schema.mjs`. O schema é uma fonte única: o validador de estrutura percorre exatamente o mesmo objeto exportado, usando somente seu vocabulário restrito. Não é um validador JSON Schema genérico.

## Envelope

Campos obrigatórios: `contract_version`, `taxonomy_version`, `single_issue`, `assistant_message`, `ready_for_validation`, `summary`, `clarification_question`, `confirmation_required`, `fields`.

`fields` contém exatamente `tipo`, `processo`, `subprocesso`, `sistema`, `produto` e `categoria_problema`. Propriedades desconhecidas são rejeitadas. Resumo limitado a 1.200 caracteres, mensagem a 900 e valores de entidade a 160. Não há truncamento silencioso.

Cada campo contém:

| Propriedade | Regra |
| --- | --- |
| `value` | Valor extraído/classificado ou null; não exige nome canônico |
| `entity_id` | ID validado pelo sistema, somente para entidade conhecida e homologada; null para tipos/categorias |
| `evidence` | observed, inferred, suggested ou none |
| `sources` | Lista de `message_index` (base zero, incluindo turnos do assistente na contagem) e `quote` literal não vazia |
| `resolution` | known, new, ambiguous, absent, not_applicable ou unresolved |
| `pending_reason` | Justificativa obrigatória para ambiguous, new e unresolved |
| `confidence` | null ou número finito entre 0 e 1; sinal não calibrado, sem poder de decisão |

## Significado dos estados

- `known`: tipo/categoria pertence à taxonomia, ou entidade cujo ID foi validado no snapshot homologado e corresponde ao tipo do campo.
- `new`: entidade proposta depois de busca sem correspondência; candidato, nunca homologação.
- `unresolved`: nome extraído, mas dicionário ainda não consultado/resolução ainda não concluída. Estado usado na fase de interpretação, antes da entrega B resolver IDs.
- `ambiguous`: há disputa entre interpretações. `value` e ID ficam null; a pendência impede revisão até esclarecimento.
- `absent`: não informado; value e ID null, evidence none, sources vazias e confidence null. Não obriga pergunta se opcional.
- `not_applicable`: entidade não pertinente à situação. Mesmos valores vazios de absent. Não é permitido para tipo/categoria, que usam `outro` quando a situação compreendida está fora da taxonomia.

`observed` aponta para informação explícita. `inferred` aponta para trechos que sustentam uma conclusão limitada. `suggested` é hipótese a confirmar e impede prontidão. `none` é reservado à ausência de valor. Valores preenchidos exigem pelo menos uma origem no relato do usuário.

O validador comprova que a citação existe, não que ela sustenta semanticamente o rótulo. Respeito à negação, correções posteriores, adequação de pergunta e significado da evidência dependem de avaliação de domínio.

## Regras relacionais

1. `confirmation_required` é sempre true. Prontidão autoriza exibir revisão, não persistir automaticamente.
2. `single_issue=false` exige pergunta e `ready_for_validation=false`.
3. Enquanto não pronto: resumo null e pergunta não vazia. Quando pronto: resumo não vazio, nenhuma pergunta pendente e percepção única.
4. Para prontidão: tipo e categoria conhecidos/preenchidos; nenhum campo ambíguo ou sugerido. Campos opcionais ausentes ou nomes ainda não resolvidos não impedem revisão do relato.
5. ID conhecido só é aceito se presente no snapshot homologado com tipo correto. Modelo não pode homologar entidades.
6. A etapa de interpretação emite IDs null quando não dispõe de referências; a resolução posterior deve anexar IDs, preservando o valor extraído. A entrega A apenas especifica e testa esta fronteira.
7. Instruções dentro do relato não alteram o contrato. O histórico deve ser validado pela camada de entrada; limites atuais de 12 mensagens e 2.000 caracteres do usuário permanecem na aplicação.

## Compatibilidade implementada na entrega B

O formato anterior usava `draft` e não trazia citações, estado de resolução ou percepção única. Respostas antigas não são convertidas fabricando esses dados. Novas chamadas usam o novo contrato; a resposta inclui `fields` e `draft` com os mesmos campos. A persistência conserva `proposed_interpretation.fields` e `interpretation` para a RPC existente. Conversa, contexto, classificação completa e metadados ficam no JSON de auditoria da sessão e da interpretação. Nenhuma migração de banco foi necessária.

Um resumo corrigido, metadados de execução, versão do dicionário e decisão humana pertencem ao envelope de persistência/auditoria da entrega C; não são fatos que a IA deva inventar.
