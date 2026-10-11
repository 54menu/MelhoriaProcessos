import { analyzeConversation, recordPerception } from "./api.js";
import { createReportConfirmation } from "./report-confirmation.mjs";

const conversation = document.querySelector("#conversation");
const form = document.querySelector("#perception-form");
const input = document.querySelector("#perception");
const button = document.querySelector("#submit-button");
const count = document.querySelector("#character-count");
const status = document.querySelector("#status");
let history = [];

function setStatus(message, isError = false) {
  status.textContent = message;
  status.className = isError ? "status chat-status error" : "status chat-status";
}
function addMessage(author, text, extraClass = "") {
  const message = document.createElement("article");
  message.className = `chat-message ${author} ${extraClass}`.trim();
  const speaker = document.createElement("p"); speaker.className = "chat-speaker"; speaker.textContent = author === "user" ? "Você" : "Assistente";
  const bubble = document.createElement("p"); bubble.className = "chat-bubble"; bubble.textContent = text;
  message.append(speaker, bubble); conversation.append(message);
  message.scrollIntoView({ block: "nearest", behavior: "smooth" });
  return message;
}
function offerNextStep() {
  addMessage("assistant", "Há mais alguma percepção que você gostaria de compartilhar ou prefere encerrar por aqui?");
  const actions = document.createElement("div"); actions.className = "chat-actions conversation-choice";
  const continueButton = document.createElement("button"); continueButton.type = "button"; continueButton.textContent = "Compartilhar outra";
  const endButton = document.createElement("button"); endButton.type = "button"; endButton.className = "secondary"; endButton.textContent = "Encerrar conversa";
  continueButton.addEventListener("click", () => { actions.remove(); form.hidden = false; setStatus("Certo. O que mais você gostaria de compartilhar?"); input.focus(); });
  endButton.addEventListener("click", () => { actions.remove(); form.hidden = true; addMessage("assistant", "Tudo bem. Quando precisar, é só recarregar a página para iniciar uma nova conversa."); setStatus("Conversa encerrada."); });
  actions.append(continueButton, endButton); conversation.append(actions); setStatus("Escolha se deseja continuar ou encerrar a conversa.");
}
function renderInterpretation(data) {
  form.hidden = true;
  const card = createReportConfirmation({ document, data,
    onConfirm: async () => {
      await recordPerception(data.analysis_id);
      addMessage("assistant", "Obrigado. Seu relato foi enviado para a equipe de gestão.");
      history = []; offerNextStep();
    },
    onCorrect: () => { form.hidden = false; setStatus("Conte o que precisa ser corrigido no entendimento do relato."); input.focus(); }
  });
  conversation.append(card);
  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

input.addEventListener("input", () => { count.textContent = `${input.value.length} / 2000`; });
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = input.value.trim(); if (!message) return;
  button.disabled = true; input.disabled = true; addMessage("user", message); input.value = ""; count.textContent = "0 / 2000"; setStatus("Estou organizando o que você contou…");
  try {
    const userChars = [...history.filter((item) => item.role === "user").map((item) => item.text), message].join("\n").length;
    if (userChars > 2000) throw new Error("Esta conversa já reuniu muitos detalhes. Registre ou inicie uma nova situação.");
    const pendingHistory = [...history, { role: "user", text: message }];
    const data = await analyzeConversation(pendingHistory);
    history = pendingHistory;
    addMessage("assistant", data.ready_for_validation ? "Preparei um resumo do que você contou. Confira se entendi corretamente." : data.assistant_message, data.ready_for_validation ? "validation-message" : "clarification-message");
    history.push({ role: "assistant", text: data.assistant_message });
    if (data.ready_for_validation) { renderInterpretation(data); setStatus("Confira o resumo antes de registrar."); }
    else setStatus("Responda à pergunta do assistente para continuar.");
  } catch (error) { input.value = message; count.textContent = `${message.length} / 2000`; addMessage("assistant", "Não consegui interpretar essa mensagem agora. Você pode tentar novamente?", "error-message"); setStatus(error.message, true); }
  finally { button.disabled = false; input.disabled = false; input.focus(); }
});
