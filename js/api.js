function configuration() {
  const config = window.APP_CONFIG;
  if (!config?.supabaseUrl || !config?.supabaseAnonKey || config.supabaseUrl.includes("SEU-PROJETO")) {
    throw new Error("Configuração ausente. Preencha js/config.js com os dados públicos do Supabase.");
  }
  return config;
}

async function invoke(functionName, payload) {
  const { supabaseUrl, supabaseAnonKey } = configuration();
  let response;
  try {
    response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Sem conexão com o backend. Confira sua internet e a URL do Supabase em js/config.js.");
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || "Não foi possível concluir a operação.");
  }
  return body;
}

export function analyzeConversation(messages) {
  return invoke("analyze-perception", { messages });
}

export function recordPerception(analysisId, classification, summary, reviewerLabel) {
  return invoke("record-perception", { analysis_id: analysisId, classification, summary, reviewer_label: reviewerLabel });
}

export function dictionaryOperation(operation, payload = {}) {
  return invoke("dictionary-admin", { operation, ...payload });
}

export function fetchAnalytics() {
  return invoke("operational-analytics", {});
}

export function semanticOperation(operation, payload = {}) {
  return invoke("semantic-intelligence", { operation, ...payload });
}

export function evolutionOperation(operation, payload = {}) {
  return invoke("knowledge-evolution", { operation, ...payload });
}

export function curationOperation(operation, payload = {}) {
  return invoke("knowledge-curation", { operation, ...payload });
}
