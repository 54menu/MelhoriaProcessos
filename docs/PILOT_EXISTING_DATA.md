# Piloto com registros existentes

Preparação em 10/10/2026, após entregas A–F. Por orientação do responsável pelo projeto, esta fase usa os registros atuais e não utiliza e-mails. Identificação de quem revisa permanece autodeclarada. Esta fase exploratória não autoriza aprovação automática nem constitui piloto operacional com identidade verificada.

## Base e revisão

Consulta inicial: cinco percepções, nenhuma revisão na trilha da entrega C, nenhum exemplo publicado e nenhum usuário cadastrado. Os registros históricos são propostas de comparação; não são gabaritos independentes. Textos e identificadores permanecem em `.test-artifacts/pilot-2026-10-10/`, excluído do Git. Não publicar o conteúdo operacional no repositório.

O caderno local identifica divergências a conferir em tipo, categoria, processo, subprocesso, sistema e produto. A avaliação usa o texto original concatenado, pois a consulta não reconstrói perguntas intermediárias. A informação ausente não deve ser inferida a partir dos rótulos históricos.

## Execução controlada

Reanalisar os cinco relatos no endpoint atual, apenas depois da autorização explícita de envio ao Supabase/Gemini. Não chamar confirmação. Cada chamada pode criar sessão temporária e evento de acompanhamento; esses eventos são tentativas de teste, não cinco novas percepções. Guardar respostas e falhas sem excluir resultados ruins.

Depois de uma pessoa revisar as propostas, registrar nome declarado, data, justificativa e alternativas aceitas. As cinco percepções são amostra exploratória: não permitem concluir acurácia representativa nem reservar uma bateria independente robusta. Manter a base sintética e novos relatos reais separados desta amostra.

## Comparação reproduzível de modelos

O comparador agora aceita `--dataset` no formato `{ "version": "...", "cases": [...] }` da entrega A e `--catalog` no formato do catálogo aprovado. `--dictionary` continua selecionando o snapshot congelado. Rótulos de base externa devem ter revisão aprovada, responsável e data para `--execute`; o planejamento aceita revisão pendente. IDs e textos duplicados, inclusive entre dev/test, são recusados. Coincidências normalizadas com exemplos usados para ensinar também são recusadas. Isso não detecta todas as paráfrases: a separação exige revisão humana.

```text
npm run eval:models -- --dataset .test-artifacts/pilot-2026-10-10/reference-proposed.json --dictionary caminho/dicionario.json --catalog caminho/catalogo.json
```

Esse comando só prepara a avaliação, sem enviar relatos. Após revisão e autorização de envio, acrescentar `--execute`, transporte autorizado e pasta nova `--output-dir`. A configuração mantém os limites de chamadas da entrega D. O plano guarda a base utilizada e os hashes das referências e da implementação, incluindo a política da entrega F.

Não promover modelo ou catálogo a partir de divergência com o histórico. Primeiro decidir qual classificação é sustentada pelo relato, registrar a revisão e analisar os resultados completos.

## Verificação da preparação

83 testes técnicos passaram. Planejamento com os cinco registros importados: cinco casos de desenvolvimento, zero revisados e teto de 20 tentativas para comparação entre dois modelos. Nenhuma chamada é feita pelo planejamento. Execução com essa base pendente foi recusada antes de consultar credenciais ou chamar provedores. A reanálise exploratória pelo endpoint atual também não foi executada: a revisão automática solicitou autorização explícita de envio dos textos ao Supabase/Gemini.
