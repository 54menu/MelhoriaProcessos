import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PROMPT_VERSION = "conversation-5w2h.0";
const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.5-flash-lite";
const TYPES = ["reclamacao", "sugestao", "duvida", "elogio", "outro"] as const;
const CATEGORIES = ["erro", "lentidao", "acesso", "usabilidade", "integracao", "processo", "informacao", "outro"] as const;
const EVIDENCE = ["observed", "inferred", "suggested"] as const;
const FIELD_NAMES = ["tipo", "processo", "subprocesso", "sistema", "produto", "categoria_problema"] as const;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

type FieldValue = { value: string | null; evidence: string; confidence: number };
type Turn = { role: "user" | "assistant"; text: string };
type Dialogue = { assistant_message: string; ready_for_validation: boolean; draft: Record<(typeof FIELD_NAMES)[number], FieldValue>; summary: string | null };

const fieldSchema = { type: "object", properties: { value: { type: "string", nullable: true }, evidence: { type: "string", enum: EVIDENCE }, confidence: { type: "number", minimum: 0, maximum: 1 } }, required: ["value", "evidence", "confidence"] };
const responseSchema = { type: "object", properties: {
  assistant_message: { type: "string" }, ready_for_validation: { type: "boolean" }, summary: { type: "string", nullable: true },
  draft: { type: "object", properties: Object.fromEntries(FIELD_NAMES.map((name) => [name, fieldSchema])), required: FIELD_NAMES },
}, required: ["assistant_message", "ready_for_validation", "summary", "draft"] } as const;

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function validField(value: unknown): value is FieldValue {
  if (!value || typeof value !== "object") return false;
  const field = value as Record<string, unknown>;
  return (typeof field.value === "string" || field.value === null) && typeof field.evidence === "string" && EVIDENCE.includes(field.evidence as typeof EVIDENCE[number]) && typeof field.confidence === "number" && Number.isFinite(field.confidence) && field.confidence >= 0 && field.confidence <= 1;
}
function validDialogue(value: unknown): value is Dialogue {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>; const draft = data.draft as Record<string, unknown>;
  if (typeof data.assistant_message !== "string" || !data.assistant_message.trim() || data.assistant_message.length > 900 || typeof data.ready_for_validation !== "boolean" || !(typeof data.summary === "string" || data.summary === null) || !draft || typeof draft !== "object") return false;
  if (!FIELD_NAMES.every((name) => validField(draft[name]))) return false;
  if ((draft.tipo.value !== null && !TYPES.includes(draft.tipo.value as typeof TYPES[number])) || (draft.categoria_problema.value !== null && !CATEGORIES.includes(draft.categoria_problema.value as typeof CATEGORIES[number]))) return false;
  return !data.ready_for_validation || (typeof data.summary === "string" && data.summary.trim().length > 0 && draft.tipo.value !== null && draft.categoria_problema.value !== null);
}
function turns(value: unknown): Turn[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) return null;
  const parsed = value.map((item) => item && typeof item === "object" ? { role: (item as Record<string, unknown>).role, text: (item as Record<string, unknown>).text } : null);
  if (parsed.some((item) => !item || (item.role !== "user" && item.role !== "assistant") || typeof item.text !== "string" || !item.text.trim() || item.text.trim().length > 2000)) return null;
  const result = parsed as Turn[];
  if (result[0].role !== "user" || result.at(-1)?.role !== "user") return null;
  if (result.filter((item) => item.role === "user").reduce((total, item) => total + item.text.trim().length, 0) > 2000) return null;
  return result.map((item) => ({ role: item.role, text: item.text.trim() }));
}
async function createAnalysisSession(history: Turn[], rawResponse: unknown, dialogue: Dialogue) {
  const url = Deno.env.get("SUPABASE_URL"); const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (!url || !serviceKey) throw new Error("persistence_not_configured");
  const originalText = history.filter((item) => item.role === "user").map((item) => item.text).join("\n");
  const interpretation = { interpretation: dialogue.summary, fields: dialogue.draft };
  const { data, error } = await createClient(url, serviceKey, { auth: { persistSession: false } }).from("analysis_sessions").insert({ original_text: originalText, prompt_version: PROMPT_VERSION, model: MODEL, raw_response: rawResponse, proposed_interpretation: interpretation }).select("id").single();
  if (error || !data?.id) throw new Error("analysis_session_failed"); return data.id as string;
}
function promptFor(history: Turn[]) {
  return `Você é um analista de processos conversando em português brasileiro. Conduza uma conversa natural, direta e acolhedora, como em um chat. Seu objetivo é entender uma percepção antes de classificá-la, nunca preencher um formulário cedo demais.

Use 5W2H como guia flexível: o que aconteceu ou é proposto; onde/em qual processo, sistema e produto; quem é afetado; quando/frequência; impacto; como ocorre hoje; e expectativa de melhoria. Não interrogue todos os itens se não forem relevantes. Em cada turno, faça apenas UMA pergunta curta, prioritizando a lacuna que mais ajuda a entender o caso. Não invente fatos e não transforme inferência em fato.

Enquanto faltarem contexto suficiente, ready_for_validation deve ser false, summary deve ser null, draft pode ter null e assistant_message deve conter somente a próxima pergunta ou uma resposta breve seguida dessa pergunta. Quando houver entendimento suficiente de situação, processo/contexto e impacto ou intenção, ready_for_validation deve ser true, summary deve ser uma síntese curta e assistant_message deve convidar a pessoa a revisar o resumo. Nunca declare que algo foi registrado.

Taxonomias: tipo = reclamacao, sugestao, duvida, elogio, outro. categoria_problema = erro, lentidao, acesso, usabilidade, integracao, processo, informacao, outro. Para cada campo draft, use evidence observed, inferred ou suggested e confidence entre 0 e 1. processo, subprocesso, sistema e produto não são entidades homologadas; produto é opcional e só deve ser preenchido com o que foi mencionado ou está claramente implicado no relato — nunca sugira nomes de produtos e nunca invente.

Histórico: ${JSON.stringify(history)}\nVersão: ${PROMPT_VERSION}`;
}

async function invokeGemini(history: Turn[]): Promise<{ rawResponse: unknown; dialogue: Dialogue }> {
  const apiKey = Deno.env.get("GEMINI_API_KEY"); if (!apiKey) throw new Error("gemini_not_configured");
  let lastError = "gemini_unavailable";
  for (let attempt = 0; attempt < 2; attempt++) {
    const provider = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: promptFor(history) }] }], generationConfig: { responseMimeType: "application/json", responseSchema, temperature: 0.2 } }) });
    if (provider.status === 429 || provider.status >= 500) { lastError = `gemini_${provider.status}`; continue; }
    if (!provider.ok) throw new Error(`gemini_${provider.status}`);
    const rawResponse = await provider.json().catch(() => null);
    let parsed: unknown; try { parsed = JSON.parse(rawResponse?.candidates?.[0]?.content?.parts?.[0]?.text); } catch { parsed = null; }
    if (validDialogue(parsed)) return { rawResponse, dialogue: parsed };
    lastError = "invalid_provider_response";
  }
  throw new Error(lastError);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return reply(405, { error: { code: "method_not_allowed", message: "Use POST." } });
  try {
    const payload = await request.json().catch(() => null); const history = turns(payload && typeof payload === "object" ? (payload as Record<string, unknown>).messages : null);
    if (!history) return reply(400, { error: { code: "invalid_conversation", message: "Envie uma conversa válida, com até 12 mensagens e 2.000 caracteres do usuário." } });
    let dialogue: Dialogue; let rawResponse: unknown;
    try {
      ({ rawResponse, dialogue } = await invokeGemini(history));
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_provider_response") {
        return reply(502, { error: { code: "invalid_provider_response", message: "A IA não retornou o contrato de conversa esperado." } });
      }
      throw error;
    }
    const analysisId = dialogue.ready_for_validation ? await createAnalysisSession(history, rawResponse, dialogue) : null;
    return reply(200, { analysis_id: analysisId, contract_version: PROMPT_VERSION, model: MODEL, ...dialogue });
  } catch (error) {
    const code = error instanceof Error ? error.message : "unexpected_error"; console.error("conversation analysis failed", code);
    return reply(502, { error: { code: "upstream_failure", message: "Não foi possível continuar a conversa agora." } });
  }
});
