# Contrato de IA — conversa orientada por 5W2H

Versão: `conversation-5w2h.0`.

A IA recebe o histórico curto da conversa e devolve apenas JSON validado. Cada chamada produz uma resposta natural ao usuário e um rascunho interno de classificação. Nenhuma sessão de análise é criada enquanto `ready_for_validation` for `false`.

```json
{
  "assistant_message": "Em qual processo essa busca é realizada?",
  "ready_for_validation": false,
  "summary": null,
  "draft": {
    "tipo": { "value": "sugestao", "evidence": "observed", "confidence": 0.94 },
    "processo": { "value": null, "evidence": "suggested", "confidence": 0.15 },
    "subprocesso": { "value": null, "evidence": "suggested", "confidence": 0.10 },
    "sistema": { "value": "sistema de busca de veículos", "evidence": "observed", "confidence": 0.80 },
    "produto": { "value": "Financiamento de veículos", "evidence": "inferred", "confidence": 0.55 },
    "categoria_problema": { "value": "usabilidade", "evidence": "inferred", "confidence": 0.62 }
  }
}
```

Quando houver contexto suficiente, `ready_for_validation` passa a `true`, `summary` torna-se uma síntese curta e `tipo` e `categoria_problema` são obrigatoriamente preenchidos. `produto` (ex.: Consórcio, CDC) é opcional: só preenchido quando mencionado ou claramente implicado, nunca inventado. Só então o backend cria `analysis_id`, que permite a confirmação humana pelo fluxo existente.

## Guia conversacional

O 5W2H orienta a investigação sem virar formulário: o que aconteceu ou é proposto, onde ocorre, quem é afetado, quando/frequência, impacto, como ocorre e qual melhoria é esperada. A IA faz uma pergunta curta por turno e só solicita o que for útil para compreender a situação.

O histórico aceita no máximo 12 mensagens e até 2.000 caracteres enviados pelo usuário. Isso mantém a conversa compatível com o limite de persistência da percepção confirmada.
