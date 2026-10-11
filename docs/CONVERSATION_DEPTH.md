# Aprofundamento da conversa — prompt contextual-classification.2

O analista deve compreender atividade, ocorrência concreta e consequência antes de propor revisão. Identificar tipo e categoria, isoladamente, deixou de ser o critério de conclusão. Pergunta uma lacuna relevante por turno e preenche progressivamente os seis campos com evidências da conversa, sem esperar o momento de confirmar.

Prioriza etapa, duração/prazo, impacto, frequência e sistema/canal conforme a situação. Não exige preencher todos os campos, não inventa hierarquia nem repete o que foi informado. Produto explícito deve ser aproveitado. Uma resposta «sim» a uma confirmação prematura não supre as lacunas. A orientação limita o aprofundamento a três perguntas, respeita desconhecimento ou recusa de detalhar e considera o teto de seis mensagens do usuário. São instruções ao modelo, não uma garantia determinística de qualidade semântica.

Modelo preservado: gemini-3.5-flash-lite. A mudança nesta entrega é de condução e critérios de prontidão. Confirmação humana continua obrigatória. Nova versão do prompt separa avaliações e impede reutilizar relatórios de publicação da entrega E feitos com o prompt anterior. Os gabaritos históricos de prontidão também precisam ser revisados para avaliar este novo comportamento; não comparar percentuais de encaminhamento entre políticas diferentes como se fossem equivalentes.

## Verificação

83 testes técnicos passaram antes da publicação. Testes remotos sintéticos, sem confirmar percepções:

| Cenário | Resultado inicial |
| --- | --- |
| Relato curto de demora no resgate de consórcio | Perguntou a etapa, preservando processo, produto, tipo e categoria; não criou sessão de confirmação |
| Resposta com etapa, sistema, duração, frequência e impacto | Preparou revisão com os seis campos preenchidos e resumo contextualizado |
| Usuário não sabe mais detalhes e quer encerrar | Preparou revisão limitada ao relato, sem inventar etapa ou sistema |
| Relato completo desde o início | Resposta inválida bloqueada pelo validador |

Após acrescentar diagnóstico restrito a códigos de validação, a repetição do quarto cenário retornou 200 e preparou revisão sem perguntar novamente. A falha inicial foi preservada e sua causa não foi confirmada. Não interpretar a repetição como quatro acertos na primeira execução. Resultados locais em `.test-artifacts/depth-validation/`, excluídos do Git.

O diagnóstico não registra valores dos campos, citações, conversas ou credenciais. Ainda é necessário ampliar a avaliação de conversas completas para medir qualidade das perguntas, omissões e falhas de contrato.
