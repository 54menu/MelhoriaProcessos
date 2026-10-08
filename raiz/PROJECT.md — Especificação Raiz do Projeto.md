# Plataforma de Inteligência Operacional Baseada na Voz dos Funcionários

**Documento:** `PROJECT.md`  
**Versão:** 1.0.0  
**Status:** Arquitetura aprovada — desenvolvimento faseado por MVP  
**Data:** 18/09/2026

---

# 1. Propósito deste documento

Este documento é a **especificação raiz do projeto**.

Ele deve permanecer na pasta principal do projeto e ser considerado a principal referência para qualquer agente de IA, desenvolvedor ou colaborador que trabalhe no sistema.

Seu objetivo é definir:

- o que o produto é;
- o que o produto não é;
- arquitetura;
- princípios;
- modelo conceitual;
- regras da inteligência artificial;
- estrutura de dados;
- estratégia de evolução;
- sequência de desenvolvimento;
- critérios de validação;
- limites de cada MVP.

## Regra fundamental

**Nenhuma fase posterior deve ser construída antes que a fase atual seja validada.**

O projeto deve evoluir por evidências, não por antecipação de funcionalidades.

---

# 2. Visão do produto

O produto é uma:

> **Plataforma de Inteligência Operacional baseada na voz dos funcionários.**

O chat é apenas a interface de entrada.

O verdadeiro produto é a capacidade de transformar percepções operacionais expressas em linguagem natural em **informação estruturada, auditável, quantificável e evolutiva**.

Fluxo conceitual:

```text
Funcionário
     ↓
Percepção em linguagem natural
     ↓
Chat
     ↓
IA
     ↓
Interpretação
     ↓
Classificação estruturada
     ↓
Confirmação humana
     ↓
Registro validado
     ↓
Base operacional
     ↓
Análise quantitativa
     ↓
Padrões / recorrências / anomalias
     ↓
Inteligência Operacional
```

---

# 3. Problema que o produto resolve

Empresas acumulam conhecimento operacional em:

- conversas;
- e-mails;
- reuniões;
- reclamações;
- chamados;
- planilhas;
- mensagens;
- pesquisas;
- relatos de funcionários;
- documentos;
- sistemas internos.

Grande parte desse conhecimento permanece em formato textual e não estruturado.

Consequentemente, torna-se difícil responder perguntas como:

- Quais processos apresentam mais problemas?
- Quais sistemas concentram reclamações?
- Quais problemas estão crescendo?
- Quais problemas são recorrentes?
- Quais unidades enfrentam o mesmo problema?
- Quais conceitos novos estão surgindo?
- Onde a classificação atual da empresa não é suficiente?
- O que os funcionários percebem que não aparece nos indicadores tradicionais?

O produto pretende transformar esse conhecimento disperso em uma estrutura operacional analisável.

---

# 4. O que o produto NÃO é

O sistema não deve ser tratado simplesmente como:

- chatbot de reclamações;
- formulário com IA;
- classificador de textos;
- pesquisa de satisfação;
- caixa de sugestões;
- sistema de chamados.

Esses elementos podem existir, mas não representam o produto completo.

O produto é uma camada de **interpretação e organização da percepção operacional**.

---

# 5. Princípios fundamentais

## 5.1 Uma percepção por registro

Cada registro deve representar uma percepção/problema principal.

Exemplo:

> "O GRAN trava na inclusão e o processo de aprovação demora muito."

Existem potencialmente dois problemas.

O sistema deve identificar isso e perguntar qual problema deve ser registrado primeiro.

Depois poderá oferecer o registro do segundo problema.

---

## 5.2 A IA não deve inventar conhecimento

Quando a informação não estiver suficientemente determinada:

> **a IA deve perguntar.**

Ela não deve preencher campos críticos simplesmente porque uma resposta parece provável.

---

## 5.3 A IA interpreta; o sistema governa

A IA fornece interpretação e sugestões.

Ela não possui autoridade para:

- homologar entidades;
- alterar definitivamente o dicionário;
- modificar registros históricos;
- criar categorias oficiais;
- aprovar seu próprio conhecimento.

A decisão final pertence às regras do sistema e/ou ao usuário autorizado.

---

# 6. Arquitetura aprovada

A arquitetura inicial está definida como:

```text
                    INTERNET
                       │
                       ▼
              ┌─────────────────┐
              │   GitHub Pages  │
              │    Frontend     │
              └────────┬────────┘
                       │ HTTPS
                       ▼
              ┌─────────────────┐
              │ Supabase Edge   │
              │    Function     │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │     Gemini      │
              │       IA        │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │    Supabase     │
              │   PostgreSQL    │
              └─────────────────┘
```

---

# 7. Tecnologias aprovadas

## Frontend

**GitHub + GitHub Pages**

Responsável por:

- interface;
- chat;
- interação com funcionário;
- apresentação da interpretação;
- confirmação/correção;
- chamadas HTTPS para o backend.

O GitHub Pages é considerado apenas camada de apresentação.

---

## Backend

**Supabase Edge Functions**

Responsável por:

- receber solicitações do frontend;
- validar entrada;
- chamar Gemini;
- validar resposta da IA;
- aplicar regras de negócio;
- resolver entidades;
- persistir informações;
- controlar segurança;
- registrar auditoria.

---

## Banco de dados

**Supabase PostgreSQL**

Responsável por armazenar:

- percepções;
- interpretações;
- classificações;
- entidades;
- candidatos;
- validações;
- correções;
- auditoria;
- versões.

---

## Inteligência Artificial

**Gemini**

O Gemini será o provedor inicial de inteligência artificial.

Entretanto, a aplicação deve possuir uma camada de abstração:

```text
AI Service
    ↓
Gemini Provider
```

Isso evita acoplamento excessivo.

Futuramente outro modelo poderá ser utilizado sem reconstruir o sistema inteiro.

---

# 8. Segurança da chave Gemini

A chave da API do Gemini **NUNCA deve ser colocada no frontend**.

É proibido:

```text
GitHub Pages
    ↓
Gemini API diretamente
```

A arquitetura correta é:

```text
GitHub Pages
    ↓
Supabase Edge Function
    ↓
Gemini
```

A chave deve permanecer em secrets/configuração segura do ambiente Supabase.

---

# 9. Modelo conceitual de conhecimento

O sistema deve distinguir cinco conceitos.

## 9.1 Campos fixos

Os campos fazem parte da estrutura do produto.

Exemplo inicial:

```text
tipo
processo
subprocesso
sistema
produto
categoria_problema
```

Os campos não são criados pela IA. `produto` (ex.: Consórcio, CDC) é texto livre e opcional: processo, subprocesso e sistema normalmente pertencem a um produto, que evolui como 4º tipo de entidade no dicionário.

---

## 9.2 Valores dinâmicos

Os valores dentro dos campos podem evoluir.

Exemplo:

```text
sistema
├── GRAN
├── GAX
├── SAP
├── Sistema X
└── Sistema Y
```

A empresa pode descobrir novos sistemas ao longo do uso.

---

## 9.3 Contexto

São elementos encontrados no relato que ajudam a explicar o problema, mas não devem automaticamente virar entidades corporativas.

Exemplos:

```text
botão Salvar
tela de inclusão
campo CPF
mensagem de erro
aba Garantias
```

---

## 9.4 Candidatos a entidade

São conceitos identificados pela IA que podem representar conhecimento novo.

Exemplo:

```text
Funcionário:
"O GAX não permite concluir a operação."

IA:
entity_candidate:
  nome: GAX
  tipo_sugerido: sistema
```

O candidato ainda não é conhecimento homologado.

---

## 9.5 Entidades homologadas

São conceitos oficialmente reconhecidos pelo sistema após validação humana.

Exemplo:

```text
GAX
Tipo: Sistema
Status: Homologado
```

---

# 10. Dicionário Operacional Evolutivo

O Dicionário Operacional Evolutivo é um dos principais ativos do produto.

Ele representa o conhecimento operacional específico de cada organização.

Não deve ser considerado um cadastro estático.

Ele evolui a partir das percepções reais.

Exemplo:

```text
SISTEMAS
├── GRAN
├── GAX
└── SAP

PROCESSOS
├── Garantias
├── Crédito
└── Cadastro

SUBPROCESSOS
├── Inclusão
├── Alteração
└── Consulta
```

---

# 11. Estados do conhecimento

Os conceitos:

- observado;
- inferido;
- sugerido;
- homologado

não devem ser tratados como uma hierarquia única.

São dimensões diferentes.

O sistema deve separar:

## Estado da evidência

```text
observed
inferred
suggested
```

## Estado de governança

```text
candidate
homologated
rejected
consolidated
```

A IA pode observar, inferir e sugerir.

A IA **não homologa**.

O backend deve controlar o estado oficial.

---

# 12. Evolução do dicionário

O sistema deverá futuramente suportar quatro operações principais.

## DISCOVER

Descoberta de novo conceito.

```text
"GAX"
↓
novo candidato a sistema
```

## GROUP

Identificação de conceitos possivelmente equivalentes.

```text
"Sistema GRAN"
"GRAN"
"GRAN sistema"
```

Podem representar a mesma entidade.

## RELATE

Identificação de relações recorrentes.

```text
GRAN
↓
Garantias
↓
Inclusão
```

## REFINE

Identificação de necessidade de refinamento de categoria.

Exemplo:

```text
Erro
```

pode futuramente evoluir para:

```text
Erro
├── Erro de validação
├── Erro de integração
├── Erro de acesso
└── Erro de processamento
```

A IA sugere.

Um humano decide.

---

# 13. Proveniência

Todo conhecimento relevante deve possuir origem rastreável.

Exemplo:

```text
Entidade: GAX
Tipo: Sistema

Ocorrências: 27
Confirmações: 24
Correções: 3
Status: Homologado

Origem:
Percepções de funcionários

Homologado por:
Área responsável

Data:
YYYY-MM-DD
```

O sistema deve permitir responder:

> "De onde surgiu este conhecimento?"

---

# 14. Fluxo de uma percepção

## Etapa 1 — entrada

Funcionário escreve:

> "O sistema trava quando tento salvar a garantia."

---

## Etapa 2 — interpretação

Gemini interpreta o texto.

---

## Etapa 3 — estruturação

A IA identifica:

```text
tipo
processo
subprocesso
sistema
categoria
contexto
```

---

## Etapa 4 — resolução

O backend verifica o Dicionário Operacional.

Pode encontrar:

```text
GRAN
```

ou não encontrar nada.

---

## Etapa 5 — ambiguidade

Se necessário, o sistema pergunta.

Exemplo:

> "Você está se referindo ao sistema GRAN?"

---

## Etapa 6 — confirmação

O funcionário recebe:

> Entendi que você está relatando um erro no processo de inclusão de garantias no sistema GRAN. Está correto?

```text
[ Confirmar ]
[ Corrigir ]
```

---

## Etapa 7 — persistência

Somente após a validação o registro definitivo é gravado.

---

# 15. Separação entre informação original e interpretação

O sistema nunca deve substituir o texto original pela interpretação da IA.

Devem coexistir:

```text
original_text
```

e:

```text
ai_interpretation
```

e:

```text
validated_classification
```

Exemplo:

```text
Texto original:
"O GRAN fica louco quando vou salvar."

Interpretação:
"Instabilidade no sistema GRAN durante a operação de salvamento."

Classificação validada:
Sistema = GRAN
Categoria = Erro
```

---

# 16. IA como fonte não confiável

Toda saída do Gemini deve ser considerada **entrada não confiável**.

Fluxo obrigatório:

```text
Gemini
 ↓
Raw Response
 ↓
JSON Parser
 ↓
Schema Validator
 ↓
Business Rules
 ↓
Entity Resolver
 ↓
Canonical Record
 ↓
Database
```

A IA nunca deve possuir acesso direto para decidir o estado definitivo do banco.

---

# 17. Contrato inicial da IA

O contrato deve contemplar, no mínimo:

```json
{
  "single_issue": true,
  "interpretation": "...",
  "fields": {
    "tipo": {},
    "processo": {},
    "subprocesso": {},
    "sistema": {},
    "categoria_problema": {}
  },
  "context": [],
  "entity_candidates": [],
  "clarification_required": false,
  "clarification_question": null,
  "confirmation_required": true
}
```

O contrato deverá ser versionado.

Exemplo:

```text
PROMPT_VERSION = v1.0.0
```

---

# 18. Regra importante sobre `single_issue`

O sistema deve ser conservador.

Não deve assumir:

```text
campo ausente = single_issue true
```

Se a IA não informar claramente a estrutura da percepção, o backend deve tratar a resposta como potencialmente inválida ou solicitar nova análise.

---

# 19. Confidence

`confidence` é apenas um **sinal heurístico**.

Não representa probabilidade estatística calibrada.

Deve:

- estar entre 0 e 1;
- ser validado pelo backend;
- nunca ser utilizado sozinho para homologação;
- ser armazenado para análise posterior.

Exemplo:

```text
confidence = 0.91
```

não significa:

> "Existe 91% de probabilidade de estar correto."

Significa apenas que o modelo apresentou alta confiança segundo sua própria avaliação.

---

# 20. Resolução de entidades

A IA não deve ser responsável sozinha por determinar se um termo já existe.

O sistema deverá possuir um mecanismo separado:

```text
Entity Resolver
```

Possível ordem:

```text
1. correspondência exata
       ↓
2. sinônimo
       ↓
3. correspondência normalizada
       ↓
4. correspondência semântica
       ↓
5. candidato novo
```

A implementação semântica/embeddings será adicionada em fase posterior.

---

# 21. MVP 0 — Fundação técnica

## Objetivo

Validar exclusivamente a infraestrutura.

### Construir

- GitHub repository;
- GitHub Pages;
- frontend mínimo;
- Supabase;
- Edge Function;
- secret Gemini;
- conexão Gemini;
- retorno JSON;
- tabela mínima de teste.

### Fluxo

```text
Browser
 ↓
GitHub Pages
 ↓
Supabase Edge Function
 ↓
Gemini
 ↓
JSON
 ↓
Browser
```

### Não construir

- embeddings;
- dashboard;
- dicionário completo;
- multiempresa;
- analytics avançado;
- clustering;
- autenticação complexa.

### Critério de aprovação

Executar aproximadamente 20–30 chamadas consecutivas e verificar:

- conectividade;
- latência;
- estabilidade;
- retorno JSON;
- tratamento de erro;
- segurança da chave.

**Só depois avançar.**

---

# 22. MVP 1 — Interpretação e classificação

## Objetivo

Validar o núcleo de inteligência.

Entrada:

> "O GRAN trava quando tento incluir uma garantia."

Saída estruturada:

```text
Tipo: Reclamação
Processo: Garantias
Subprocesso: Inclusão
Sistema: GRAN
Categoria: Erro
```

### Deve testar

1. percepção simples;
2. problema de sistema;
3. problema de processo;
4. problema de interface;
5. ambiguidade;
6. múltiplos problemas;
7. termos desconhecidos;
8. linguagem informal;
9. erros ortográficos;
10. frases curtas.

### Critério de aprovação

Criar uma bateria de aproximadamente 50–100 percepções.

Cada resultado será comparado com uma avaliação humana.

Medir separadamente:

```text
Tipo
Processo
Subprocesso
Sistema
Categoria
Contexto
```

O objetivo desta fase não é atingir perfeição.

É descobrir **onde a IA funciona e onde ela falha**.

---

# 23. MVP 2 — Confirmação e persistência

## Objetivo

Transformar a interpretação em registro operacional validado.

Fluxo:

```text
Funcionário
 ↓
Texto
 ↓
IA
 ↓
Interpretação
 ↓
Confirmação
 ↓
Correção, se necessário
 ↓
Registro final
 ↓
Supabase
```

### Dados mínimos

#### perceptions

```text
id
original_text
created_at
```

#### ai_interpretations

```text
id
perception_id
prompt_version
raw_response
interpretation
created_at
```

#### classifications

```text
id
perception_id
tipo
processo
subprocesso
sistema
categoria_problema
validated_at
```

#### corrections

```text
id
perception_id
field
ai_value
final_value
created_at
```

### Critério de aprovação

Funcionário deve conseguir:

```text
relatar
→ revisar
→ confirmar/corrigir
→ registrar
```

sem intervenção administrativa.

---

# 24. MVP 3 — Dicionário Operacional Evolutivo

## Objetivo

Fazer o sistema começar a aprender o vocabulário operacional da organização.

Implementar:

- entidades;
- sinônimos;
- candidatos;
- evidências;
- status;
- homologação;
- rejeição;
- consolidação.

Exemplo:

```text
GAX
↓
candidate
↓
revisão humana
↓
homologated
```

### Critério de aprovação

O administrador deve conseguir visualizar:

- conceitos novos;
- frequência;
- evidências;
- origem;
- sugestões da IA;
- estado de governança.

---

# 25. MVP 4 — Inteligência de recorrência

## Objetivo

Transformar registros individuais em informação gerencial.

Implementar inicialmente:

- contagem;
- recorrência;
- evolução temporal;
- agrupamento;
- concentração por sistema;
- concentração por processo;
- concentração por unidade.

Exemplo:

```text
GRAN
  Garantias
    Inclusão
      Erro
        127 ocorrências
```

### Critério de aprovação

O sistema deve conseguir responder:

> "Quais problemas estão se repetindo?"

com base nos dados armazenados.

---

# 26. MVP 5 — Evolução assistida do conhecimento

Implementar:

```text
DISCOVER
GROUP
RELATE
REFINE
```

A IA poderá sugerir:

- novas entidades;
- sinônimos;
- agrupamentos;
- relações;
- refinamento de categorias.

Mas:

```text
IA → sugere
Humano → aprova
Sistema → registra
```

---

# 27. MVP 6 — Inteligência semântica

Somente nesta fase introduzir:

- embeddings;
- pgvector;
- busca semântica;
- similaridade;
- agrupamento semântico;
- detecção de recorrência semanticamente equivalente;
- anomalias.

Exemplo:

```text
"GRAN travou na inclusão"

≈

"O sistema de garantias congelou durante a inclusão"
```

Mesmo que as palavras sejam diferentes, o sistema poderá reconhecer a relação.

---

# 28. MVP 7 — Produto SaaS (histórico substituído)

> Decisão posterior: a ferramenta opera como instituição única. A migration `20260918188000_single_institution.sql` removeu empresas, seleção de empresa e isolamento multiempresa; autenticação e papéis institucionais foram preservados em `user_roles`.

Somente após validação do núcleo.

Implementar:

```text
Empresa
 ├── Usuários
 ├── Unidades
 ├── Percepções
 ├── Dicionário
 ├── Regras
 └── Indicadores
```

Cada empresa deve possuir isolamento lógico dos dados.

O Supabase será responsável pela camada de persistência, autenticação e políticas de acesso.

---

# 29. O que não deve ser antecipado

Durante os MVPs iniciais, NÃO adicionar apenas porque "poderá ser útil":

- aplicativo mobile;
- notificações;
- WhatsApp;
- Slack;
- Teams;
- integrações corporativas;
- BI externo;
- machine learning próprio;
- fine-tuning;
- embeddings;
- análise documental;
- processos BPM;
- automações complexas;
- múltiplos provedores de IA;
- marketplace;
- funcionalidades SaaS avançadas.

Esses itens só devem entrar quando existir evidência de necessidade.

---

# 30. Fine-tuning

Não faz parte do MVP inicial.

O sistema deve primeiro acumular:

```text
Texto original
+
Interpretação IA
+
Correção humana
+
Classificação final
```

Esse conjunto poderá futuramente formar um dataset de alta qualidade.

Somente depois avaliar:

- fine-tuning;
- modelos especializados;
- classificação dedicada;
- modelos menores para redução de custo.

O conhecimento proprietário principal inicialmente estará no **dicionário, histórico, regras, exemplos e validações**, e não em um modelo treinado do zero.

---

# 31. Auditoria

O sistema deverá preservar:

```text
texto original
versão do prompt
resposta bruta da IA
classificação proposta
correção humana
classificação final
versão do dicionário
data/hora
usuário responsável
```

Isso permite reconstruir:

> "Como o sistema chegou a essa classificação?"

---

# 32. Métricas de qualidade da IA

O sistema deverá futuramente calcular métricas por campo.

Exemplo:

```text
Sistema       96,2%
Processo      88,7%
Subprocesso   76,4%
Categoria     91,3%
```

Também medir:

- taxa de confirmação;
- taxa de correção;
- taxa de esclarecimento;
- conceitos desconhecidos;
- entidades novas;
- erros por campo;
- recorrência de correções.

Essas métricas são mais importantes do que simplesmente observar a `confidence` retornada pelo modelo.

---

# 33. Segurança e privacidade

Desde o início considerar:

- princípio do menor privilégio;
- RLS no Supabase;
- segregação de dados por empresa;
- secrets fora do frontend;
- logs controlados;
- minimização de dados pessoais;
- controle de acesso administrativo;
- auditoria.

O texto fornecido pelo funcionário deve ser tratado como dado potencialmente sensível da organização.

---

# 34. Estrutura inicial do projeto

Estrutura sugerida:

```text
operational-intelligence/
│
├── PROJECT.md
├── README.md
│
├── index.html
├── admin.html
│
├── css/
│   ├── app.css
│   └── admin.css
│
├── js/
│   ├── app.js
│   ├── chat.js
│   ├── api.js
│   └── supabase.js
│
├── supabase/
│   ├── migrations/
│   └── functions/
│       └── analyze-perception/
│           └── index.ts
│
└── docs/
    ├── AI_CONTRACT.md
    ├── AI_RULES.md
    ├── ENTITY_RESOLUTION.md
    └── MVP_VALIDATION.md
```

A estrutura poderá evoluir, mas `PROJECT.md` deve continuar sendo a referência raiz.

---

# 35. Regra para agentes de IA

Qualquer agente de IA que trabalhar neste projeto deve:

1. Ler `PROJECT.md` antes de modificar o projeto.
2. Identificar o MVP atualmente autorizado.
3. Não implementar funcionalidades de MVP futuro sem autorização.
4. Não alterar decisões arquiteturais sem registrar a mudança.
5. Não colocar secrets no frontend.
6. Não tratar saída da IA como dado confiável.
7. Não homologar entidades automaticamente.
8. Preservar dados originais.
9. Preservar rastreabilidade.
10. Validar cada etapa antes de avançar.

---

# 36. Regra de progressão

O projeto funciona por **gate de validação**.

```text
MVP 0
  ↓
VALIDADO?
  ├── NÃO → corrigir
  └── SIM
        ↓
MVP 1
        ↓
VALIDADO?
  ├── NÃO → corrigir
  └── SIM
        ↓
MVP 2
        ↓
...
```

Não avançar por expectativa.

Avançar por evidência.

---

# 37. Critério geral de sucesso

O produto deverá demonstrar progressivamente cinco capacidades:

### 1. Entender

A IA consegue interpretar o que o funcionário escreveu.

### 2. Estruturar

A percepção livre vira informação organizada.

### 3. Validar

O funcionário consegue confirmar ou corrigir a interpretação.

### 4. Aprender

O sistema consegue incorporar novos conceitos por meio do Dicionário Operacional Evolutivo.

### 5. Descobrir

A organização consegue encontrar padrões que não eram evidentes nos relatos individuais.

---

# 38. Visão de longo prazo

A evolução pretendida é:

```text
                     VOZ DOS FUNCIONÁRIOS
                              │
                              ▼
                           CHAT
                              │
                              ▼
                            GEMINI
                              │
                              ▼
                    INTERPRETAÇÃO OPERACIONAL
                              │
                              ▼
                     VALIDAÇÃO HUMANA
                              │
                              ▼
                 DICIONÁRIO OPERACIONAL
                       EVOLUTIVO
                              │
                              ▼
                     BASE ESTRUTURADA
                              │
               ┌──────────────┼──────────────┐
               ▼              ▼              ▼
          Recorrências     Padrões       Anomalias
               │              │              │
               └──────────────┼──────────────┘
                              ▼
                   INTELIGÊNCIA OPERACIONAL
                              │
                              ▼
                     DECISÃO ORGANIZACIONAL
```

O objetivo final não é substituir a decisão humana.

É fornecer uma representação estruturada e evolutiva da realidade operacional percebida pelas pessoas que executam os processos.

---

# 39. Estado atual do projeto

## Decisões aprovadas

- [x] Gemini como IA inicial
- [x] Supabase como backend/banco
- [x] PostgreSQL
- [x] Edge Functions
- [x] GitHub como repositório
- [x] GitHub Pages como hospedagem do frontend
- [x] Arquitetura faseada por MVP
- [x] Validação obrigatória entre fases
- [x] Dicionário Operacional Evolutivo
- [x] Validação humana
- [x] Preservação do texto original
- [x] Auditoria
- [x] Abstração do provedor de IA
- [x] Embeddings somente em fase posterior

## Ainda precisam ser definidos antes do MVP 1

- [ ] Taxonomia definitiva de `tipo`
- [ ] Inclusão ou não de `impacto` no MVP
- [ ] Taxonomia inicial de `categoria_problema`
- [ ] Schema JSON definitivo
- [ ] Regras definitivas de Entity Resolver
- [ ] Dataset inicial de testes
- [ ] Critérios quantitativos de aprovação do MVP 1

---

# 40. Próxima ação autorizada

A próxima etapa do projeto é exclusivamente:

> **Construir e validar o MVP 0 — Fundação Técnica.**

O MVP 0 deverá produzir:

```text
GitHub Pages
      ↓
Chat mínimo
      ↓
Supabase Edge Function
      ↓
Gemini
      ↓
JSON válido
      ↓
Retorno ao chat
```

Após essa validação, o projeto deverá parar e apresentar os resultados antes de iniciar o MVP 1.

**Não implementar o MVP 1 automaticamente.**

---

# 41. Princípio final

O projeto deve crescer de:

> **IA que interpreta uma percepção**

para:

> **sistema que organiza o conhecimento operacional de uma empresa**

e, posteriormente:

> **plataforma que identifica padrões e mudanças na realidade operacional da organização.**

A complexidade deve ser conquistada progressivamente através de validação real.

**Construir → testar → medir → corrigir → validar → avançar.**
