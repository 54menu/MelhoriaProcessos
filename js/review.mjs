const labels = { tipo: "Tipo", processo: "Processo", subprocesso: "Subprocesso", sistema: "Sistema", produto: "Produto", categoria_problema: "Natureza da situação" };
const names = { reclamacao: "Reclamação", sugestao: "Sugestão", duvida: "Dúvida", elogio: "Elogio", outro: "Outro", erro: "Erro", lentidao: "Lentidão", acesso: "Acesso", usabilidade: "Usabilidade", integracao: "Integração", processo: "Processo", informacao: "Informação" };
const evidence = { observed: "Informado no relato", inferred: "Inferido pela IA — confira", suggested: "Sugerido pela IA — confira", none: "Sem evidência" };
const resolutions = { known: "Conceito homologado", new: "Conceito novo — ainda não homologado", ambiguous: "Identificação ambígua", unresolved: "Identificação pendente", absent: "Não informado", not_applicable: "Não se aplica" };

export function createReview({ document, data, onConfirm, onCancel }) {
  const el = (tag, text, className) => { const n = document.createElement(tag); if (text) n.textContent = text; if (className) n.className = className; return n; };
  const card = el("article", "", "chat-review");
  const form = el("form", "", "conversation-editor");
  card.append(el("h2", "Revise antes de registrar"), el("p", "Confira as inferências e ajuste o resumo e os campos quando necessário. Confirmar o relato não homologa conceitos novos."), form);
  const summary = el("textarea"); summary.name = "summary"; summary.value = data.summary || ""; summary.required = true; summary.maxLength = 1200; summary.rows = 3;
  const summaryLabel = el("label", "Resumo revisado"); summaryLabel.append(summary); form.append(summaryLabel);
  const controls = {};
  for (const [name, label] of Object.entries(labels)) {
    const field = (data.fields || data.draft)[name];
    const wrapper = el("label", label);
    const choices = name === "tipo" ? ["reclamacao", "sugestao", "duvida", "elogio", "outro"] : name === "categoria_problema" ? ["erro", "lentidao", "acesso", "usabilidade", "integracao", "processo", "informacao", "outro"] : null;
    const control = el(choices ? "select" : "input"); control.name = name;
    if (choices) {
      for (const value of ["", ...choices]) { const option = el("option", names[value] || "Selecione…"); option.value = value; option.selected = value === (field?.value || ""); control.append(option); }
      control.required = true;
    } else { control.value = field?.value || ""; control.maxLength = 160; }
    controls[name] = control; wrapper.append(control); form.append(wrapper);
    const context = el("div", "", "review-evidence");
    context.append(el("span", evidence[field?.evidence] || "Sem evidência", "review-badge"), el("span", resolutions[field?.resolution] || "Identificação pendente", "review-badge"));
    if (field?.pending_reason) context.append(el("p", field.pending_reason));
    if (field?.sources?.length) {
      const details = el("details"); details.append(el("summary", "Trechos que apoiaram a proposta"));
      for (const source of field.sources) details.append(el("blockquote", source.quote));
      context.append(details);
    }
    form.append(context);
  }
  form.append(el("p", "Os rótulos e trechos acima descrevem a proposta original da IA; seus ajustes serão registrados separadamente.", "muted"));
  const reviewer = el("input"); reviewer.name = "reviewer_label"; reviewer.required = true; reviewer.maxLength = 120; reviewer.autocomplete = "name";
  const reviewerLabel = el("label", "Quem revisou este registro?"); reviewerLabel.append(reviewer); form.append(reviewerLabel, el("p", "Identificação declarada por você, sem verificação de login.", "muted"));
  const message = el("p", "", "status"); message.setAttribute("role", "status");
  const save = el("button", "Confirmar e registrar"); save.type = "submit";
  const cancel = el("button", "Voltar à conversa", "secondary"); cancel.type = "button";
  form.append(message, save, cancel);
  let busy = false;
  cancel.addEventListener("click", () => { if (!busy) { card.remove(); onCancel(); } });
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (busy) return;
    const values = Object.fromEntries(Object.entries(controls).map(([key, control]) => [key, control.value.trim() || null]));
    if (!summary.value.trim() || !reviewer.value.trim() || !values.tipo || !values.categoria_problema) { message.textContent = "Preencha resumo, tipo, natureza e identificação de quem revisou."; return; }
    busy = true; const all = [...form.querySelectorAll("input,textarea,select,button")]; all.forEach(c => { c.disabled = true; }); message.textContent = "Registrando…";
    try {
      await onConfirm(values, summary.value.trim(), reviewer.value.trim());
      message.textContent = "Registro confirmado. Os ajustes e a proposta original foram preservados.";
      save.remove(); cancel.remove();
    } catch (error) { message.textContent = error.message; all.forEach(c => { c.disabled = false; }); busy = false; }
  });
  return card;
}
