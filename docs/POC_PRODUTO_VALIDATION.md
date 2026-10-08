# Validação — campo PRODUTO (POC aberta, sem login)

Produto (ex.: Consórcio, CDC) é texto livre e opcional: processo, subprocesso e
sistema normalmente pertencem a um produto. Vira 4º eixo operacional —
classificado, candidato no dicionário, dimensão de recorrência e de anomalia.

## Roteiro

1. Relate algo com produto explícito (ex.: "O GRAN trava na inclusão de garantia do Consórcio").
   A IA deve preencher `produto=Consórcio` sem perguntar além do necessário.
2. Confirme o registro → `classifications.produto` preenchido; `entity_evidence`
   com `field_name=produto`; candidato `Consórcio (produto)` em `admin.html`.
3. Relate algo sem produto → registra com `produto` nulo; nenhum candidato criado.
4. Homologue o produto → `homologated` + evento; sinônimo (ex.: "consorcio")
   resolve para a mesma entidade no próximo relato com variação.
5. Em `analytics.html`: combinação passa a incluir produto; existe o bloco
   "Concentração por produto"; evolução diária exibe produto.
6. Em `semantic.html`: anomalias exibem `sistema · processo · produto`.
7. Em `evolution.html`: `generate` pode sugerir `discover` (homologar produto
   candidato), `group` (consolidar variações) e `relate` (produto ↔ sistema).

## Gate

Produto nunca é inventado (nulo quando ausente), alimenta dicionário como os
demais eixos, indicadores reproduzem a dimensão sem inferência além dos dados.
