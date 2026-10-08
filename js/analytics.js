import { fetchAnalytics } from "./api.js";

const status = document.querySelector("#status");
const metrics = document.querySelector("#metrics");
const recurrences = document.querySelector("#recurrences");
const systems = document.querySelector("#systems");
const processes = document.querySelector("#processes");
const products = document.querySelector("#products");
const evolution = document.querySelector("#evolution");
const coverage = document.querySelector("#unit-coverage");

function setStatus(message, isError = false) {
  status.textContent = message;
  status.className = isError ? "status error" : "status";
}
function barList(target, items, format) {
  target.innerHTML = "";
  const max = Math.max(1, ...items.map((item) => item.occurrences));
  items.slice(0, 12).forEach((item) => {
    const row = document.createElement("div");
    row.className = "bar-item";
    const label = document.createElement("span");
    label.textContent = format(item);
    const value = document.createElement("strong");
    value.textContent = String(item.occurrences);
    const rail = document.createElement("div");
    rail.className = "bar-rail";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = `${Math.round((item.occurrences / max) * 100)}%`;
    rail.append(fill);
    row.append(label, value, rail);
    target.append(row);
  });
  if (!items.length) target.textContent = "Sem dados ainda.";
}

async function load() {
  setStatus("Carregando indicadores…");
  try {
    const data = await fetchAnalytics();
    metrics.innerHTML = "";
    [
      ["Percepções validadas", data.total_validated_perceptions],
      ["Combinações recorrentes", data.recurring_combinations],
    ].forEach(([label, value]) => {
      const card = document.createElement("div");
      card.className = "metric";
      card.textContent = label;
      const strong = document.createElement("strong");
      strong.textContent = String(value);
      card.append(strong);
      metrics.append(card);
    });
    barList(recurrences, data.top_recurrences, (row) => `${row.sistema ?? "?"} · ${row.processo ?? "?"} · ${row.subprocesso ?? "?"} · ${row.produto ?? "?"} · ${row.categoria_problema}`);
    barList(systems, data.by_system, (row) => row.name);
    barList(processes, data.by_process, (row) => row.name);
    barList(products, data.by_product ?? [], (row) => row.name);
    barList(evolution, data.daily_evolution, (row) => `${row.occurrence_date} · ${row.sistema ?? "?"} · ${row.processo ?? "?"} · ${row.produto ?? "?"}`);
    coverage.textContent = data.unit_coverage.message;
    setStatus(`Indicadores de recorrência exata. ${data.note ?? ""}`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

document.querySelector("#refresh").addEventListener("click", load);
await load();
