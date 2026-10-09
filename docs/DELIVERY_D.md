# Entrega D — comparação de modelos e preparação do piloto

## Implementação

O executor compara `gemini-3.5-flash-lite` (linha de base) e `gemini-3.8-flash` (candidato), com as mesmas mensagens, taxonomia, prompt, exemplos e snapshot do dicionário. Alterna a ordem das chamadas, aplica os validadores reais e resolve entidades pelo mesmo pipeline da aplicação. O modo de avaliação desativa a criação de sessões e não grava percepções.

`npm run eval:models` mostra o plano sem chamar APIs. A configuração inicial usa 20 casos sintéticos de desenvolvimento, uma repetição e limite máximo de 80 tentativas. Os 20 casos `test` ficam reservados. `max_calls` é um teto de tentativas, não orçamento financeiro. Para executar localmente com chave no ambiente:

```text
npm run eval:models -- --execute --output-dir .test-artifacts/comparacao
```

A pasta de saída deve ser nova e seu diretório pai deve existir. `--config` e `--dictionary` permitem selecionar uma configuração e snapshot JSON versionados. A opção `--relay-config` aceita transporte temporário autenticado no Supabase, mantendo a chave Gemini exclusivamente no servidor.

## Artefatos e métricas

Cada execução salva plano, checkpoint, respostas, relatório, divergências e formulário de revisão humana. Registra hashes da base, contrato, taxonomia, prompt, implementação, dicionário e exemplos; modelo solicitado e versão retornada; consumo e duração de cada tentativa, inclusive tentativas inválidas. Exportações individuais são compatíveis com o avaliador da entrega A.

Falhas contam como erro e não são excluídas. Custo financeiro permanece nulo: tokens não equivalem à cobrança confirmada. O relatório não escolhe nem promove automaticamente um modelo. A revisão semântica e o esforço humano têm campos vazios para preenchimento real, vinculados ao hash da execução.

Limites: comparação de análises em snapshots, não conversas completas; casos sintéticos com gabaritos propostos; busca semântica por embeddings desativada para ambos; raciocínio usa configuração padrão do provedor. Snapshot vazio significa ausência de conhecimento institucional nessa execução. Duração via transporte remoto inclui a passagem pelo Supabase.

## Configuração e retorno à versão anterior

`CLASSIFICATION_MODEL` controla a interpretação; `EVOLUTION_MODEL` controla sugestões de conhecimento. Ambos preservam `GEMINI_MODEL` como fallback e `gemini-3.5-flash-lite` como padrão final. Alterar a classificação não obriga alterar sugestões. Para retornar ao modelo anterior, configurar `CLASSIFICATION_MODEL=gemini-3.5-flash-lite` e conferir o campo `model` da resposta; preservar a versão de código anterior para rollback de implementação.

## Critérios para concluir a seleção

1. Revisar os gabaritos e ratificar os limiares da entrega A.
2. Analisar resultados de desenvolvimento e revisar invenções, perguntas e correções.
3. Congelar configuração e executar os casos reservados, sem adaptá-los ao candidato.
4. Executar comparação em relatos reais anonimizados, sem alterar resultados oficiais.
5. Fazer piloto supervisionado com identidade e acesso adequados. Medir correções, turnos, esforço humano, latência e custo por percepção concluída.
6. Adotar somente com melhoria demonstrada e ausência de regressões relevantes; retornar à configuração anterior em caso de falhas.

A implementação técnica não certifica o modelo nem libera autonomia. A publicação e os resultados desta execução são registrados em `DEPLOYMENT_ABCD.md`.

## Referências consultadas

- [Seleção de modelos — OpenAI](https://developers.openai.com/api/docs/guides/model-selection): avaliação no fluxo real, considerando qualidade, custo e latência.
- [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash): candidato e suporte a saída estruturada.
- [GenerateContent](https://ai.google.dev/api/generate-content): retorno de versões e consumo.
- [Variáveis de ambiente — Supabase](https://supabase.com/docs/guides/functions/secrets): configuração no servidor.
