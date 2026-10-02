import { dictionaryOperation } from "./api.js";

const table = document.querySelector("#entities");
const evidence = document.querySelector("#evidence");
const status = document.querySelector("#status");
const refresh = document.querySelector("#refresh");

function setStatus(message, isError = false) {
  status.textContent = message;
  status.className = isError ? "status error" : "status";
}

function actionButton(label, onClick, secondary = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.className = secondary ? "secondary compact" : "compact";
  button.addEventListener("click", onClick);
  return button;
}

async function showDetail(id) {
  setStatus("Carregando evidências…");
  try {
    const data = await dictionaryOperation("detail", { entity_id: id });
    evidence.hidden = false;
    evidence.innerHTML = "";
    const title = document.createElement("h2");
    title.textContent = `${data.entity.canonical_name} (${data.entity.entity_type})`;
    evidence.append(title);
    const aliases = document.createElement("p");
    aliases.textContent = `Sinônimos: ${(data.aliases ?? []).map((item) => item.alias).join(", ") || "nenhum"}`;
    evidence.append(aliases);
    (data.evidence ?? []).forEach((item) => {
      const line = document.createElement("p");
      line.className = "semantic-line";
      line.textContent = `[${item.field_name}/${item.evidence_state}] ${item.extracted_value}`;
      evidence.append(line);
    });
    const form = document.createElement("form");
    form.className = "semantic-search";
    form.innerHTML = "";
    const input = document.createElement("input");
    input.placeholder = "Novo sinônimo";
    input.maxLength = 160;
    const add = document.createElement("button");
    add.type = "submit";
    add.textContent = "Adicionar sinônimo";
    form.append(input, add);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await dictionaryOperation("add_alias", { entity_id: id, alias: input.value });
        setStatus("Sinônimo vinculado.");
        await load();
      } catch (error) {
        setStatus(error.message, true);
      }
    });
    evidence.append(form);
    setStatus("Evidências carregadas. Origem rastreável por percepção.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function mutate(operation, payload, confirmMessage) {
  try {
    if (operation === "consolidate") {
      const target = window.prompt("ID da entidade destino (mesmo tipo)?");
      if (!target) return;
      payload.target_entity_id = target.trim();
    }
    await dictionaryOperation(operation, payload);
    setStatus(confirmMessage);
    await load();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function load() {
  setStatus("Carregando entidades…");
  table.innerHTML = "";
  try {
    const data = await dictionaryOperation("list", {});
    if (!data.entities.length) {
      setStatus("Nenhum candidato ainda. Confirme uma percepção com processo/sistema para alimentar o dicionário.");
      return;
    }
    data.entities.forEach((entity) => {
      const row = document.createElement("tr");
      const name = document.createElement("td");
      name.textContent = entity.canonical_name;
      const type = document.createElement("td");
      type.textContent = entity.entity_type;
      const statusCell = document.createElement("td");
      statusCell.textContent = `${entity.governance_status} · ${entity.perception_count} percepções`;
      const count = document.createElement("td");
      count.textContent = String(entity.evidence_count);
      const actions = document.createElement("td");
      actions.className = "row-actions";
      actions.append(
        actionButton("Detalhar", () => showDetail(entity.id), true),
        actionButton("Homologar", () => mutate("homologate", { entity_id: entity.id }, "Entidade homologada.")),
        actionButton("Rejeitar", () => mutate("reject", { entity_id: entity.id }, "Candidato rejeitado."), true),
        actionButton("Consolidar", () => mutate("consolidate", { entity_id: entity.id }, "Entidades consolidadas."), true),
      );
      row.append(name, type, statusCell, count, actions);
      table.append(row);
    });
    setStatus(`${data.entities.length} entidades. Governança aberta da POC: sem login.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

refresh.addEventListener("click", load);
await load();
