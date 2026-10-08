# Resolução de entidades — limite do MVP 1

O MVP 1 **não homologa nem resolve** entidades. Ele apenas identifica candidatos em `entity_candidates`.

A partir do MVP 3, a ordem prevista será: correspondência exata, sinônimo, normalização, correspondência semântica e candidato novo. Embeddings e correspondência semântica não fazem parte deste MVP.
Um candidato deve conter nome, tipo sugerido (`processo`, `subprocesso`, `sistema` ou `produto`), estado de evidência e sinal de confiança. Ele não altera dicionário algum.
