import { evolutionOperation } from "./api.js";

const status = document.querySelector("#status");
const suggestions = document.querySelector("#suggestions");
const generateButton = document.querySelector("#generate");
const refreshButton = document.querySelector("#refresh");

function setStatus(message, isError = false) {
  status.textContent = message;
  status.className = isError ? "status error" : "status";
}

function describe(item) {
  const proposal = item.proposal ?? {};
  if (proposal.rationale) return String(proposal.rationale);
  if (proposal.proposed_category) return `Refinar ${proposal.parent_category ?? "?"} → ${proposal.proposed_category}`;
  return "Sem justificativa.";
}

async function review(id, approved) {
  try {
    setStatus(approved ? "Aplicando aprovação humana…" : "Registrando rejeição…");
    await evolutionOperation("review", { suggestion_id: id, approved });
    setStatus(approved ? "Sugestão aprovada e aplicada." : "Sugestão rejeitada sem alterar dados operacionais.");
    await load();
  } catch (error) {
    setStatus(error.message, true);
  }
}

function render(items) {
  suggestions.replaceChildren();
  if (!items.length) {
    suggestions.textContent = "Ainda não há sugestões. Gere a partir do dicionário e da recorrência.";
    return;
  }
  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "suggestion";
    const title = document.createElement("h2");
    title.textContent = `${item.suggestion_type} · ${item.status}`;
    const summary = document.createElement("p");
    summary.textContent = describe(item);
    const details = document.createElement("pre");
    details.textContent = JSON.stringify(item.proposal, null, 2);
    card.append(title, summary, details);
    if (Array.isArray(item.evidence) && item.evidence.length) {
      const evidence = document.createElement("p");
      evidence.className = "semantic-line";
      evidence.textContent = `Evidências: ${item.evidence.join(" · ")}`;
      card.append(evidence);
    }
    if (item.status === "pending") {
      const actions = document.createElement("div");
      actions.className = "admin-actions";
      const approve = document.createElement("button");
      approve.type = "button";
      approve.textContent = "Aprovar";
      approve.addEventListener("click", () => review(item.id, true));
      const reject = document.createElement("button");
      reject.type = "button";
      reject.textContent = "Rejeitar";
      reject.className = "secondary";
      reject.addEventListener("click", () => review(item.id, false));
      actions.append(approve, reject);
      card.append(actions);
    }
    suggestions.append(card);
  });
}

async function load() {
  setStatus("Carregando sugestões…");
  try {
    const data = await evolutionOperation("list", {});
    const items = data.suggestions ?? [];
    render(items);
    const pending = items.filter((item) => item.status === "pending").length;
    setStatus(`${items.length} sugestões (${pending} pendentes). Aprovação humana aplica; rejeição não altera dados.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

generateButton.addEventListener("click", async () => {
  setStatus("Gerando propostas a partir do dicionário e da recorrência…");
  try {
    const data = await evolutionOperation("generate", {});
    setStatus(`${data.created} sugestões novas registradas como pendentes.`);
    await load();
  } catch (error) {
    setStatus(error.message, true);
  }
});
refreshButton.addEventListener("click", load);

await load();
