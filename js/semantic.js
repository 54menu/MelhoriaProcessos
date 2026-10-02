import { semanticOperation } from "./api.js";

const status = document.querySelector("#status");
const matches = document.querySelector("#matches");
const pairs = document.querySelector("#pairs");
const anomalies = document.querySelector("#anomalies");
const coverage = document.querySelector("#coverage");

function setStatus(message, isError = false) {
  status.textContent = message;
  status.className = isError ? "status error" : "status";
}
function lines(target, items, render) {
  target.innerHTML = "";
  if (!items.length) {
    target.textContent = "Sem resultados.";
    return;
  }
  items.slice(0, 20).forEach((item) => {
    const line = document.createElement("p");
    line.className = "semantic-line";
    line.textContent = render(item);
    target.append(line);
  });
}

async function loadInsights() {
  try {
    const data = await semanticOperation("insights", {});
    lines(pairs, data.semantic_pairs ?? [], (row) => `${row.similarity.toFixed(3)} · ${row.source_text} ⇄ ${row.target_text}`);
    lines(anomalies, data.anomalies ?? [], (row) => `${row.recent_occurrences}x · ${row.sistema ?? "?"} · ${row.processo ?? "?"} · crescimento ${row.growth_ratio ?? "novo"}`);
    lines(coverage, [{ text: `${data.embedded_perceptions} percepções com embedding. ${data.warning}` }], (row) => row.text);
    return data;
  } catch (error) {
    setStatus(error.message, true);
    return null;
  }
}

document.querySelector("#backfill").addEventListener("click", async () => {
  setStatus("Gerando embeddings pendentes…");
  try {
    const result = await semanticOperation("backfill", {});
    setStatus(`Embutidos ${result.embedded} nesta leva. ${result.remaining_batch_available ? "Há mais pendentes." : "Sem pendências."}`);
    await loadInsights();
  } catch (error) {
    setStatus(error.message, true);
  }
});
document.querySelector("#insights").addEventListener("click", async () => {
  setStatus("Atualizando pares e anomalias…");
  await loadInsights();
  setStatus("Pares são candidatos, não consolidações. Anomalia indica variação, não causa.");
});
document.querySelector("#search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = document.querySelector("#query").value.trim();
  if (!query) return;
  setStatus("Buscando por sentido…");
  try {
    const data = await semanticOperation("search", { query });
    lines(matches, data.matches ?? [], (row) => `${row.similarity.toFixed(3)} · ${row.original_text}`);
    setStatus(`${(data.matches ?? []).length} resultados. Texto original e classificação preservados.`);
  } catch (error) {
    setStatus(error.message, true);
  }
});

await loadInsights();
