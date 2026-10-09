# Regras de interpretação — MVP 1

> Registro histórico do MVP 1. Para os fundamentos preparados na entrega A, consultar [DELIVERY_A.md](DELIVERY_A.md) e [CLASSIFICATION_CONTRACT_V1.md](CLASSIFICATION_CONTRACT_V1.md). O contrato em uso continua descrito em AI_CONTRACT.md.

1. Uma resposta representa apenas uma percepção principal. Havendo dois problemas, `single_issue` é `false` e a IA pergunta qual deve ser tratado primeiro.
2. A IA não completa lacunas como fato. Usa `null` e pede esclarecimento.
3. O texto original é a fonte primária; a interpretação não o substitui.
4. `observed` significa explicitamente presente no relato; `inferred`, conclusão contextual limitada; `suggested`, hipótese a confirmar.
5. Termos desconhecidos podem ser candidatos, nunca entidades homologadas.
6. `confirmation_required` é sempre `true` neste MVP. A resposta não é um registro validado e não é persistida como percepção.
7. A saída do modelo é não confiável: o backend valida JSON, estrutura, taxonomias e limites antes de devolvê-la.
