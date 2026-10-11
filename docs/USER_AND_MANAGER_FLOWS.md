# Separação entre relato do usuário e revisão do gestor

O usuário conversa para descrever a situação, confere um resumo em linguagem natural e escolhe enviar ou corrigir. Não edita tipo, categoria, entidades, evidências ou homologação; não precisa informar nome de revisor. Corrigir volta à conversa e exige nova análise, mantendo a relação entre resumo e proposta.

O envio inclui somente ID da análise e confirmação explícita. `record-perception` rejeita campos de classificação enviados pelo cliente. O servidor recupera o resumo e a proposta originais da sessão e cria uma única pendência em `report_submissions`. O relato está salvo na sessão vinculada, mas não há classificação aprovada, alteração no dicionário nem exemplo criado nesse momento.

O painel `management.html` lista relatos confirmados, apresenta o texto original e permite ao gestor conferir e editar resumo e seis campos com suas evidências. Só a aprovação pelo gestor chama a persistência revisada, produz classificação final e alimenta indicadores, evidências de entidades e fila de curadoria quando houver alterações. A confirmação prévia do usuário fica registrada separadamente, com data de envio.

Sessões precisam estar válidas no envio inicial. Depois de enviadas, a aprovação é assíncrona e pode ocorrer após o prazo da conversa. A extensão necessária para usar a persistência anterior é interna à transação e o prazo original é restaurado. Aprovação e alteração de estado da fila são atômicas; reenvio idêntico é idempotente. Registros históricos não são reclassificados nem inseridos retroativamente na fila.

Botões de gestão ficam numa seção própria, abaixo da conversa. **Separação de fluxo não é controle de acesso:** nesta fase os endpoints e painéis seguem abertos, conforme solicitado. Nome do gestor é autodeclarado. E-mail/login e autorização serão incorporados posteriormente; não se afirma que apenas gestores autenticados conseguem chamar o endpoint.

O acompanhamento distingue revisão técnica de envio do usuário; a métrica existente de tempo até revisão inclui espera na fila e registros históricos anteriores à separação. Não é medida de esforço ativo nem tempo até o usuário confirmar o resumo.

## Publicação e testes

Aplicar `20261011231453_separate_report_confirmation_from_management.sql`, publicar `management-review`, `record-perception` e `analyze-perception`, e depois atualizar o frontend. Prompt `contextual-classification.3` orienta a conversa ao usuário e reserva revisão técnica ao painel.

Testes de banco e interface cobrem fila idempotente, ausência de classificação na confirmação do usuário, revisão assíncrona pelo gestor, rollback, rejeição de campos técnicos no endpoint de envio e ausência de editor técnico na conversa. Como o contrato do envio mudou, uma página antiga aberta deve ser recarregada antes de enviar; o endpoint recusa o formato antigo em vez de registrar uma aprovação indevida.

Resultado: **89 testes aprovados**. Migração e três funções publicadas. Verificação remota: fila 200, envio com classificação técnica 400, sessão inexistente 409. Teste transacional remoto confirmou submissão sem revisão, aprovação posterior ao prazo e idempotência; transação revertida, sem manter dados de teste. Verificador de segurança: somente 20 avisos informativos de [RLS sem policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), sem WARN/ERROR; acesso direto às tabelas reservado ao servidor.
