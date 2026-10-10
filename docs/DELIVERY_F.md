# Entrega F — encaminhamento supervisionado e monitoramento

## Resultado técnico

A política `selective-review.1` separa esclarecimento, confirmação simplificada e revisão detalhada. O servidor aplica a política depois de validar o contrato, as evidências e a resolução de entidades. Confiança declarada pelo modelo não é um critério de liberação. **Nenhum caminho registra uma percepção sem confirmação humana.**

| Situação | Encaminhamento |
| --- | --- |
| Modelo ou resolvedor ainda pedem esclarecimento | Pergunta; sem sessão de confirmação |
| Uma percepção, dicionário completo, campos preenchidos explícitos e conhecidos, entidades com ID homologado | Confirmação simplificada |
| Inferência, entidade nova, resolução pendente ou dicionário incompleto | Revisão detalhada, com campos de atenção destacados |
| Simplificação suspensa | Revisão detalhada para toda proposta pronta |

Na confirmação simplificada, resumo e todos os campos continuam visíveis e editáveis. Somente os detalhes de evidência ficam recolhidos. Campos opcionais ausentes não obrigam perguntas. Uma proposta simples não equivale a acerto semântico comprovado. A resolução automática de aliases inequívocos continua sob as regras da entrega B.

## Política e suspensão

`review_policy_revisions` mantém revisões imutáveis para o servidor da aplicação; não concede UPDATE/DELETE ao `service_role`. A leitura retorna somente versão, revisão e habilitação da simplificação. Cada sessão guarda a decisão e sua revisão nos dados de auditoria. Alterações exigem acesso administrativo ao banco, com responsável e justificativa. Não há endpoint público de alteração nem opção de habilitar autorregistro.

Para suspender, executar no ambiente administrativo autorizado:

```sql
select public.set_review_simplification(false, 'Responsável real', 'Motivo da suspensão');
```

Para retomar, usar `true` após investigar e registrar a justificativa. A mudança afeta novas análises que consultarem a política; sessões já emitidas preservam a revisão original e ainda dependem de confirmação humana. Política ausente/incompatível interrompe a análise.

## Acompanhamento

`monitoring.html`, também acessível pelos Indicadores e pela Curadoria, consulta agregados para 7, 30 ou 90 dias. `classification-monitoring` é somente leitura. SQL agrega toda a janela, sem truncamento por limite de linhas do cliente.

- Tentativas, falhas, perguntas, propostas simples e detalhadas.
- Confirmações vinculadas à sessão e quantas tiveram ajustes de campos ou resumo; reenvios idênticos não duplicam contagens.
- Tempo médio e p95 da análise (incluindo falhas), turnos do usuário nas percepções confirmadas e tempo decorrido da sessão à confirmação.
- Resultados separados por modelo, prompt, revisão da política, categoria, versão de exemplos e hash do dicionário; ajustes por campo.
- Alertas visuais para falhas acima de 10% com pelo menos 20 tentativas ou ajustes acima de 10% com pelo menos 20 confirmações. São limiares operacionais iniciais para investigação, **não limiares estatísticos de liberação de autonomia**. Não suspendem o sistema automaticamente.

Eventos não contêm relato, resposta do provedor, nome do revisor ou credenciais. A aplicação continua sendo POC aberta: o endpoint expõe agregados, sem autenticação de revisores. Uma consulta pública não pode alterar a política ou ler a tabela diretamente; as novas tabelas têm RLS e permissões somente para o servidor.

Instrumentação começa nesta entrega, sem fabricar eventos retroativos. Entrada rejeitada antes de iniciar análise, falha na configuração inicial, encerramento abrupto do processo e indisponibilidade da própria escrita podem não gerar evento. Falha na escrita de acompanhamento não devolve a proposta como sucesso e pode deixar uma sessão órfã que expira. O orçamento de análise permanece 45 s, com até 3 s adicionais para acompanhamento; o tempo medido exclui essa última escrita. A avaliação offline não grava eventos.

Taxa de ajustes não é acurácia: o usuário pode aceitar erro ou apenas preferir outra redação. Tempo decorrido inclui espera e não mede trabalho humano ativo. Contagem de pedidos de esclarecimento não determina se foram úteis. Custo permanece nulo, não zero. Amostra vazia aparece como sem amostra. Testes técnicos não comprovam ganho de qualidade.

## Liberação operacional ainda pendente

Esta entrega implementa a primeira etapa da autonomia seletiva: resolução controlada e encaminhamento supervisionado. Aprovação automática de classificações completas permanece bloqueada por construção. Para avaliar uma evolução posterior:

1. Revisar e aprovar gabaritos reais de domínio, mantendo casos de teste separados dos exemplos ensinados.
2. Concluir a comparação da entrega D e a avaliação semântica da E, com hashes de modelo, prompt, taxonomia, dicionário e catálogo.
3. Preparar identificação verificada e autorização dos revisores antes do piloto operacional; a POC atual não satisfaz esse requisito.
4. Executar piloto supervisionado e avaliar erros e correções por grupo. Definir amostra representativa e limites aceitáveis com os responsáveis pelo domínio; 20 casos não autorizam automação.
5. Somente após aprovação documentada, implementar liberação restrita por grupo, amostragem independente, suspensão automática por desvios e revalidação a cada mudança relevante.

## Verificação e publicação

`npm run check`: **82 testes passaram**, incluindo onze novos da entrega F. Cobrem política, suspensão/retomada, ausência de autorregistro, registro de sucesso/falha, indisponibilidade do acompanhamento, agregação SQL, denominadores, alertas, permissões, interface e confirmação explícita. PostgreSQL executado isoladamente via PGlite e interface via DOM; suíte A–E preservada.

Aplicar primeiro `20261009234134_delivery_f_selective_review_monitoring.sql`. Publicar `classification-monitoring` e `analyze-perception` com verificação JWT habilitada, depois os arquivos do frontend. Não requer novos segredos. A biblioteca Supabase nas duas funções foi fixada em `2.117.3`.

Migração e funções publicadas no Supabase. Verificação remota concluída em 10/10/2026: acompanhamento retornou 200; janela inválida e tentativa de alterar política pelo endpoint retornaram 400. Análise real retornou 200, política revisão 1, revisão detalhada para conceito não homologado e autorregistro bloqueado. O acompanhamento contabilizou a tentativa em 5.119 ms, sem confirmação de percepção artificial.

O verificador de segurança retornou 19 avisos informativos de [RLS sem policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), coerentes com acesso direto reservado ao servidor; nenhum WARN/ERROR. A publicação no GitHub acompanha estes arquivos.
