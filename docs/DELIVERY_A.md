# Entrega A — fundamentos da classificação

Data: 08/10/2026. Autorização: implementação da entrega A e teste ao final, conforme conversa do projeto. Esta decisão sucede o gate histórico de MVP 0 na especificação raiz para este escopo.

## Escopo e estado

Implementados: taxonomia proposta, contrato versionado executável, validador offline, base de referência inicial, avaliador reproduzível e testes. O contrato em uso na aplicação continua `conversation-5w2h.0`; o novo contrato `classification.1` está preparado para integração na entrega B. Nenhuma alteração de banco, publicação, mudança de modelo ou ativação de autonomia faz parte desta entrega.

**Validação técnica concluída; validação de domínio e medição do modelo pendentes.** Não há alegação de precisão da IA. A base histórica do MVP 1 usa outro contrato e não pode certificar o atual ou o novo.

## Arquivos de referência

- `contracts/taxonomy.v1.json`: fonte das definições, campos e desempates; status proposto para revisão de domínio.
- `lib/classification-contract.mjs`: fonte única do schema JSON exportável e validações relacionais offline.
- `docs/CLASSIFICATION_CONTRACT_V1.md`: estados, evidências e migração planejada.
- `evals/reference-cases.mjs`: 40 casos sintéticos com justificativa, 20 dev e 20 test.
- `docs/DELIVERY_A_REFERENCE_REVIEW.md`: caderno legível para revisão dos 40 gabaritos.
- `lib/classification-evaluation.mjs`: métricas por campo, contrato e encaminhamento.
- `scripts/evaluate-classification.mjs`: execução local contra respostas previamente obtidas.
- `evals/delivery-a-status.json`: estado reproduzível, com métricas nulas enquanto não houver inferências.

Os módulos em `lib` são ferramentas Node de preparação e avaliação. A integração nas Edge Functions, inclusive o formato específico de schema do provedor, pertence à entrega B; não importar diretamente código dependente de `node:fs` no runtime sem adaptação e teste.

## Taxonomia e decisões adotadas

Mantidos os cinco tipos e oito categorias existentes. As definições e desempates agora são explícitos no JSON versionado. A classificação descreve a situação percebida, não diagnostica uma causa raiz não informada.

Produto, processo, subprocesso e sistema são opcionais. Não perguntar apenas para preencher todos os campos. Elogios e sugestões podem ter categoria operacional; elogio sem aspecto específico usa `outro`, preservando compatibilidade conceitual com a categoria obrigatória. `outro` nunca resolve falta de contexto.

Quando houver dois problemas independentes, pedir escolha do foco. Quando houver uma falha com uma consequência, preservar uma percepção. Em relato envolvendo vários sistemas, não selecionar arbitrariamente um deles: manter o campo ausente se isso não prejudicar a interpretação; se houver disputa de identificação relevante, marcar ambíguo e perguntar. Multivaloração fica como decisão de domínio futura.

Estas são propostas implementadas para revisão, não regras já homologadas pela organização.

## Teste técnico da entrega

Executar na raiz:

```text
npm run check
npm run eval:classification -- --split all --output evals/delivery-a-status.json
```

A bateria cobre contrato, evidência inexistente ou atribuída ao assistente, entidade não homologada, conflito de tipo de entidade, múltiplos problemas, campos opcionais, confiança não calibrada, hipótese pendente, métricas, resposta ausente, duplicação de casos e incompatibilidade de versões/hashes.

O teste do avaliador usa respostas artificiais somente para verificar cálculos. Nenhum resultado dessas fixtures representa desempenho de um modelo.

## Como medir respostas reais

1. Revisar os gabaritos com especialista. Registrar responsável/data e justificativa. Ao mudar a base, incrementar a versão e gerar novos hashes. Congelar a versão antes de comparar modelos.
2. Usar apenas os casos `dev` no desenvolvimento. Os casos `test` não entram como exemplos ou contexto do prompt. Adicionar futuramente uma amostra independente de relatos reais revisados; a base sintética pública é uma regressão inicial, não um teste estatístico representativo.
3. Executar o pipeline alvo e salvar uma resposta por caso, sem expor rótulos esperados ao modelo. O executor real ainda será integrado na entrega B/D.
4. Importar as respostas no envelope abaixo. O comando sem previsões imprime os hashes que devem ser copiados para `run`.
5. Executar `npm run eval:classification -- --predictions caminho/respostas.json --split test --output caminho/relatorio.json`.

Envelope de entrada:

```json
{
  "run": {
    "dataset_version": "classification-reference.1",
    "dataset_sha256": "copiar da execução sem previsões",
    "contract_version": "classification.1",
    "contract_sha256": "copiar da execução sem previsões",
    "taxonomy_version": "operational-taxonomy.1",
    "taxonomy_sha256": "copiar da execução sem previsões",
    "split": "test",
    "model": "identificador efetivamente utilizado",
    "prompt_version": "versão efetivamente utilizada",
    "dictionary_version": "none ou versão do snapshot",
    "executed_at": "2026-10-08T12:00:00Z"
  },
  "entities": [],
  "predictions": []
}
```

Cada item de `predictions` contém `case_id`, `output` (objeto completo `classification.1`) e, opcionalmente, `latency_ms` e `cost_usd` medidos. Falha de chamada pode ser registrada com `output: null`. Casos faltantes contam como erro; IDs duplicados ou fora do split abortam a importação. `entities` é o snapshot confiável realmente fornecido pelo executor, não entidades inventadas pela resposta. Entradas têm `id`, `entity_type`, `governance_status`. O relatório calcula seu hash.

`dictionary_version: none` exige que nenhum ID seja resolvido como conhecido. O avaliador não chama a API, não consulta produção e não transforma respostas antigas no novo contrato: inventar evidências para completar esse contrato falsearia a comparação.

O schema pode ser exportado com `npm run schema:classification` (para obter JSON sem os cabeçalhos do npm, use `node scripts/export-classification-schema.mjs`). Os casos podem ser exportados com `node scripts/export-reference-cases.mjs --json`; o arquivo inclui gabaritos e NÃO deve ser enviado integralmente ao modelo.

## Métricas e interpretação

- Acerto por campo: valores normalizados por caixa, acentos e espaços, comparados com alternativas explicitamente aceitas; não aceita equivalência semântica livre. Campos sem rótulo não entram no denominador.
- Validade de contrato: separada do acerto dos valores. Respostas inválidas são penalizadas em todos os campos avaliados daquele caso.
- Encaminhamento: acerto de prontidão e percepção única, quantidade de perguntas desnecessárias e de liberações precoces.
- Latência: média, p95 e quantidade de amostras informadas. Custo só é totalizado se informado para todos os casos, evitando total parcial enganoso.
- Revisão semântica: o especialista verifica invenções, suporte efetivo das citações, adequação das perguntas, negações e qualidade do resumo. `semantic_fabrication_rate` permanece null porque uma citação existente não prova uma conclusão correta.
- Esforço do usuário: número de turnos e taxa de correção humana serão medidos no piloto; esta avaliação de snapshots não finge medir conversas completas.

## Critérios propostos para o próximo piloto

Proposta para ratificação de domínio, não autorização automática de produção:

| Medida | Alvo inicial proposto |
| --- | --- |
| Contrato válido | 100% dos casos de regressão |
| Tipo e categoria | Pelo menos 90% de acerto em cada campo |
| Entidades nos campos rotulados | Pelo menos 85% em cada campo, com cobertura reportada |
| Revisão precoce em casos ambíguos/múltiplos | Zero nos casos críticos da bateria |
| Entidades ou fatos inventados | Zero detectado na revisão humana da bateria |
| Perguntas desnecessárias | No máximo 10% dos casos já suficientes |
| Latência/custo | Comparar com linha de base medida; orçamento ainda a definir |

A amostra pequena, sobretudo de processo/subprocesso/produto, não permite concluir segurança para autonomia. Relatar contagens e denominadores; zero erro observado não é garantia de zero risco. A decisão de liberar automação é da entrega F e requer amostra representativa, avaliação por grupos e revisão humana.

## Resultado e próximo gate

Resultado da execução local: **24 testes passaram, 0 falhas**; verificações existentes da aplicação também passaram. Base: **40 casos, 20 dev e 20 test**, todos com revisão de domínio pendente. Nenhuma chamada a modelo foi realizada.

Para concluir a validação de domínio: revisar `DELIVERY_A_REFERENCE_REVIEW.md`, ratificar taxonomia/limiares e resolver divergências de gabarito. A entrega B só começa por decisão do usuário após avaliar esta entrega. Não é necessário publicar a entrega A para executar seus testes locais.
