export function createReportConfirmation({document,data,onConfirm,onCorrect}) {
  const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
  const card=el('article');card.className='chat-review';
  card.append(el('h2','Entendi corretamente?'),el('p',data.summary),el('p','Confirme se o resumo representa o que você contou. A classificação será conferida pela equipe de gestão.'));
  const actions=el('div');actions.className='chat-actions';
  const confirm=el('button','Sim, enviar relato'),correct=el('button','Quero corrigir');confirm.type=correct.type='button';correct.className='secondary';
  const status=el('p');status.className='status';status.setAttribute('role','status');actions.append(confirm,correct);card.append(actions,status);
  let busy=false;
  correct.addEventListener('click',()=>{if(!busy){card.remove();onCorrect();}});
  confirm.addEventListener('click',async()=>{
    if(busy)return;busy=true;confirm.disabled=correct.disabled=true;status.textContent='Enviando relato…';
    try{await onConfirm();actions.remove();status.textContent='Relato enviado para a equipe de gestão.';}
    catch(error){status.textContent=error.message;busy=false;confirm.disabled=correct.disabled=false;}
  });
  return card;
}
