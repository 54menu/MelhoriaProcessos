# Entrega B — classificação contextualizada

Data: 08/10/2026. Escopo autorizado: implementar e testar a entrega B após a entrega A. Código integrado localmente; sem publicação remota, migração de banco ou troca de modelo.

## Fluxo implementado

1. Validar conversa alternada, até 12 mensagens e 2.000 caracteres do usuário, contando as quebras de linha persistidas.
2. Consultar entidades e aliases existentes, com paginação, ordenação e limite de tempo.
3. Recuperar referências por nome/alias, palavras compartilhadas e, quando disponível, similaridade das percepções já indexadas. Somente entidades homologadas são apresentadas como conhecimento aprovado.
4. Selecionar até quatro exemplos relevantes de um catálogo explicitamente revisado.
5. Chamar Gemini com instruções separadas dos dados, definições da taxonomia e schema de saída.
6. Validar o contrato `classification.1`, fontes na conversa atual, hipóteses, percepção única e limites. Modelo só extrai termos; IDs e estados de resolução são responsabilidade do servidor.
7. Resolver nome/alias normalizado contra o dicionário. Colisões exigem pergunta. Similaridade nunca homologa, consolida ou resolve automaticamente uma entidade.
8. Validar novamente a classificação resolvida e criar sessão apenas quando pronta para confirmação humana.

O novo contrato foi conectado à função `analyze-perception`. A resposta inclui `fields` e seu alias `draft`, permitindo que a tela atual continue funcionando. O registro definitivo continua passando pela confirmação e pela função `record-perception` existentes.

## Implementação

| Componente | Arquivo |
| --- | --- |
| Entrada e ligação ao Supabase | `supabase/functions/analyze-perception/index.ts` |
| Orquestração, HTTP e sessão | `supabase/functions/_shared/classification-pipeline.mjs` |
| Dicionário, recuperação e resolução | `supabase/functions/_shared/knowledge-context.mjs` |
| Prompt, schema Gemini, tentativas e embeddings | `supabase/functions/_shared/classification-provider.mjs` |
| Contrato comum à avaliação e ao servidor | `supabase/functions/_shared/classification-contract.mjs` |
| Fontes da taxonomia e exemplos | `contracts/taxonomy.v1.json`, `contracts/approved-examples.v1.json` |

Os assets gerados ficam dentro de `_shared` para serem incluídos com as Edge Functions, sem leitura de arquivos locais via Node em produção. `lib/classification-contract.mjs` reexporta a mesma implementação para a avaliação. `npm run assets:classification` atualiza os assets; `npm run check` falha se estiverem desatualizados.

## Políticas conservadoras

- Entidades candidatas, rejeitadas ou consolidadas não são conhecimento homologado. Se um termo coincidir com uma delas, fica pendente para curadoria.
- Correspondência automática exige nome/alias normalizado único, tipo correto e entidade homologada. O valor originalmente extraído é preservado; o ID é anexado.
- Nome canônico e alias são verificados juntos. Colisões não são resolvidas pela ordem de busca.
- Consulta limitada não permite declarar termo novo nem assegurar unicidade. A classificação pode ser apresentada à confirmação com a entidade não resolvida.
- Falha na consulta principal do dicionário interrompe a análise. Falha apenas na busca semântica permite continuar com busca por nomes e aliases, registrando `semantic_retrieval_unavailable`.
- O provedor não pode atribuir IDs ou declarar entidades como `known`/`new`. Essa proteção é aplicada também na fronteira da orquestração, além da chamada ao Gemini.
- Confiança nunca libera aprovação. Hipóteses ou ambiguidade impedem prontidão.
- Nenhuma nova entidade é homologada ou gravada pelo pipeline de análise. `new` é apenas sinal para futura curadoria.

## Exemplos revisados

O catálogo inicial está **vazio**. Não existe no esquema atual um marcador de curadoria de exemplos. Uma classificação confirmada pelo funcionário e uma correção isolada não equivalem a exemplo homologado para ensinar o classificador. Por isso, esta etapa usa catálogo versionado e não reaproveita indiscriminadamente todas as correções do banco.

O mecanismo de seleção está implementado e testado. Para adicionar um exemplo real, anonimizar e revisar o texto e a classificação, registrando uma entrada em `contracts/approved-examples.v1.json` com:

```json
{
  "id": "identificador-unico",
  "status": "approved",
  "reviewed_by": "identificador-real-do-revisor",
  "reviewed_at": "data-ISO-da-revisao",
  "taxonomy_version": "operational-taxonomy.1",
  "text": "relato revisado e anonimizado",
  "classification": {
    "tipo": "reclamacao",
    "categoria_problema": "erro",
    "processo": null,
    "subprocesso": null,
    "sistema": null,
    "produto": null
  }
}
```

Este bloco é apenas documentação de formato, não exemplo aprovado. Incrementar a versão do catálogo, gerar os assets, rodar testes e publicar a função após aprovação real. Entradas pendentes são excluídas; entradas marcadas aprovadas sem metadados válidos fazem a validação falhar. A tela de curadoria e o ciclo contínuo de promoção pertencem à entrega E.

## Limites conhecidos

- Dicionário: leitura de até 2.000 entidades e 4.000 aliases, em páginas de 500. Ao atingir o teto, o snapshot é marcado incompleto de forma conservadora. As duas tabelas são lidas separadamente, sem garantia transacional durante alterações concorrentes; auditoria conserva contexto consultado e hash do snapshot lido. Escala maior exige busca indexada no banco.
- Prompt: até 30 entidades, 120 aliases e quatro exemplos relevantes.
- Semântica: usa `semantic_neighbors` e `entity_evidence` existentes. Resultados de embeddings de outro modelo são descartados. A RPC atual mistura modelos antes do limite, portanto candidatos compatíveis podem ficar fora da seleção; os resultados continuam apenas referências.
- Embeddings: `gemini-embedding-001` por padrão, 768 dimensões. Sem indexação prévia, não há candidatos semânticos. Esta entrega não executa backfill automático.
- O banco só possui relações genéricas `associated_with`, não uma hierarquia homologada processo/subprocesso. O prompt proíbe inferir pai sem evidência; não se alega validação de hierarquia institucional que não existe. Definição de vínculos formais exige etapa específica.
- Citação existente não comprova significado correto. Negação, causalidade, qualidade do resumo e suficiência do relato continuam dependendo da revisão e de avaliação real do modelo.
- O modelo padrão permanece `gemini-3.5-flash-lite`; comparação/troca pertence à entrega D.
- A POC mantém o modelo de acesso atual. Autorização de curadores e usuários ainda precisa ser implementada antes de uso operacional.
- Interface detalhada de evidências e indicadores agrupados por IDs canônicos pertencem à entrega C. Nesta entrega, os IDs e referências são conservados na auditoria, sem mudar o esquema das classificações finais.

## Resiliência e rastreabilidade

Há no máximo duas tentativas de geração, com intervalo de 250 ms. Resposta inválida envia apenas códigos de validação na segunda tentativa. Erros 429/5xx e falha de rede/tempo são repetíveis; outros erros HTTP não são repetidos.

Limites: 15 s por tentativa do modelo, 7 s na consulta principal, 5 s na etapa semântica, 7 s na criação de sessão, com teto de 45 s para o pipeline. Cancelamento propaga sinal às chamadas de rede. Uma resposta não concluída não é aceita. Timeout de escrita pode deixar uma sessão órfã que expira, nunca uma percepção automaticamente confirmada.

Auditoria no JSON existente: resposta original do provedor, classificação resolvida, histórico, contexto fornecido, IDs consultados, exemplos utilizados, hashes de contexto/dicionário/catálogo, avisos e decisões do resolvedor. Mantidos `interpretation` e `fields` esperados pela RPC de confirmação. O retorno público não inclui a resposta bruta do provedor nem textos dos exemplos recuperados.

No frontend, uma falha de análise não adiciona a mensagem ao histórico enviado na tentativa seguinte; o texto volta ao campo para nova tentativa, evitando duas mensagens consecutivas do usuário e preservando a alternância exigida.

## Validação executada

Comando: `npm run check`.

Resultado: **42 testes aprovados, zero falhas** — 24 anteriores e 18 da entrega B. Os novos testes exercitam o handler HTTP, o pipeline real e a chamada ao provedor com respostas de rede controladas. Cobrem:

- Alias homologado e compatibilidade do payload de sessão/revisão.
- Entrada inválida e ausência de escrita antes da prontidão.
- Colisão de entidades, candidatos não homologados e dicionário parcial.
- Exclusão de exemplos não aprovados e validação de metadados de revisão.
- Similaridade sem resolução automática, e filtro de modelo de embedding.
- Citação inventada, ID atribuído indevidamente, resposta truncada e falhas HTTP.
- Repetição limitada, cancelamento por tempo e paginação do repositório.

**Limite da validação:** provedor e banco foram simulados nos testes; não houve chamada real ao Gemini, consulta ao banco remoto ou execução no runtime Deno. A CLI local do Supabase não inicializou por restrição de escrita de telemetria fora do workspace; Deno não estava disponível. Não se declara deploy, precisão do modelo ou compatibilidade remota comprovada.

## Teste integrado após publicação autorizada

1. Publicar `analyze-perception` incluindo `_shared`, e a alteração de `js/app.js`. Não há migration nova. Preservar a configuração de acesso vigente.
2. Confirmar secrets existentes: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`. `GEMINI_MODEL` e `GEMINI_EMBEDDING_MODEL` continuam opcionais. `CLASSIFICATION_SEMANTIC_ENABLED=false` desativa somente a recuperação semântica.
3. Com entidade e alias previamente homologados, enviar um relato que cite o alias e conferir `fields.<campo>.entity_id` e `knowledge` na resposta.
4. Conferir que sem confirmação não há nova percepção. Confirmar pela tela e verificar registro com auditoria.
5. Testar um termo novo, múltiplos problemas e relato insuficiente; conferir perguntas e ausência de homologação automática.
6. Capturar `fields` e demais campos do contrato para o avaliador da entrega A. Para importar a saída, selecionar somente o envelope `classification.1`, excluindo `draft`, `analysis_id`, `model`, `prompt_version` e `knowledge`, que são metadados HTTP. Preservar esses metadados em `run` e no artefato original de execução.
7. Comparar com gabaritos revisados; não usar os casos reservados como exemplos no prompt.

Próxima entrega: C, mediante solicitação do usuário. Nenhuma mudança de UI de curadoria, banco ou autonomia adicional foi antecipada.

## Referências técnicas consultadas

- [Bibliotecas compartilhadas nas Edge Functions](https://supabase.com/docs/guides/functions/recursive-functions)
- [Changelog de Edge Functions](https://supabase.com/changelog?tags=edge+functions)
- [Saída estruturada Gemini](https://ai.google.dev/gemini-api/docs/structured-output)
- [API generateContent](https://ai.google.dev/api/generate-content)
- [API de embeddings](https://ai.google.dev/api/embeddings)
