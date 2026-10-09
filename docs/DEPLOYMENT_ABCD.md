# Publicação das entregas A–D

Data: 09/10/2026. Publicação autorizada pelo usuário nesta tarefa.

- Projeto Supabase: `ghseibnjwiqsjmhtpgiy`.
- Repositório: `fvclares/MelhoriaProcessos`, branch `main`.
- Migração C e correção de permissões legadas aplicadas, sem reinicializar banco.
- Funções atualizadas: `analyze-perception`, `record-perception`, `operational-analytics`, `knowledge-evolution`. Verificação JWT preservada.
- Testes locais: 60 passaram. CI atualizado para instalar dependências antes de executar a suíte.
- Testes HTTP iniciais: indicadores 200 com total 5, confirmação incompleta 400, análise 200 com contrato `classification.1` e modelo `gemini-3.5-flash-lite`.
- Cinco percepções e cinco classificações existentes preservadas; nenhuma revisão retroativa inventada.

O verificador remoto identificou permissões diretas de `anon`/`authenticated` em rotinas legadas, apesar da revogação de PUBLIC nas migrações antigas. A migração `20261009143055_restrict_legacy_rpc_access.sql` revoga essas permissões e mantém execução pelo servidor. Também fixa o `search_path` da normalização. [Orientação do Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

A comparação real da entrega D está em execução sobre os 20 casos sintéticos de desenvolvimento por modelo, sem gravação de percepções. Uma função temporária protegida por JWT, token aleatório e expiração usa a chave Gemini já configurada no Supabase; a chave não é devolvida nem copiada. Os resultados finais e a remoção da função serão registrados após a execução.

O modelo operacional permanece o anterior. Gabaritos de domínio, revisão semântica e piloto supervisionado ainda são necessários antes de concluir seleção ou ampliar autonomia.
