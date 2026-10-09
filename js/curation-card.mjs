const labels={tipo:'Tipo',processo:'Processo',subprocesso:'Subprocesso',sistema:'Sistema',produto:'Produto',categoria_problema:'Natureza da situação'};
const states={pending:'Pendente',approved:'Aprovado para avaliação',active:'Em uso',rejected:'Rejeitado',retired:'Retirado'};
export function curationCard(document,item,onAction) {
  const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
  const card=el('article');card.className='suggestion';
  const source=item.perception_reviews||{};
  card.append(el('h2',states[item.status]||item.status),el('p',source.perceptions?.original_text||''));
  const changes=el('dl');changes.className='interpretation-facts';
  for(const [field,value] of Object.entries(source.changes||{})) changes.append(el('dt',labels[field]||'Resumo'),el('dd',`${value.before??'Não informado'} → ${value.after??'Não informado'}`));
  card.append(changes);
  const form=el('form');form.className='conversation-editor';card.append(form);
  const controls={};
  if(item.status==='pending') {
    form.append(el('p','Prepare um relato reutilizável, removendo dados pessoais e detalhes desnecessários. Os campos devem ser sustentados por esse texto.'));
    const text=el('textarea');text.name='text';text.value=source.perceptions?.original_text||'';text.required=true;text.maxLength=2000;
    const label=el('label','Texto do exemplo');label.append(text);form.append(label);controls.text=text;
    for(const [name,title] of Object.entries(labels)) {
      const choices=name==='tipo'?['reclamacao','sugestao','duvida','elogio','outro']:name==='categoria_problema'?['erro','lentidao','acesso','usabilidade','integracao','processo','informacao','outro']:null;
      const control=el(choices?'select':'input');control.name=name;
      const value=source.final_classification?.[name]??'';
      if(choices) {for(const v of choices){const option=el('option',v);option.value=v;option.selected=v===value;control.append(option);}control.required=true;}
      else {control.value=value;control.maxLength=160;}
      const label=el('label',title);label.append(control);form.append(label);controls[name]=control;
    }
  } else {
    form.append(el('p',item.example_text||item.review_note||''));
    if(item.classification) for(const [name,title] of Object.entries(labels)) form.append(el('p',`${title}: ${item.classification[name]??'Não informado'}`));
    form.append(el('p',`Revisado por ${item.reviewed_by||'não informado'} (identificação declarada).`));
  }
  if(!['pending','approved','active'].includes(item.status)) return card;
  const actor=el('input');actor.name='actor';actor.required=true;actor.maxLength=120;
  const actorLabel=el('label','Seu nome (identificação declarada)');actorLabel.append(actor);form.append(actorLabel);
  const note=el('textarea');note.name='note';note.required=true;note.maxLength=1000;
  const noteLabel=el('label','Justificativa');noteLabel.append(note);form.append(noteLabel);
  const message=el('p');message.setAttribute('role','status');form.append(message);
  let busy=false;
  async function act(operation,approved) {
    if(busy)return;
    if(!actor.value.trim()||!note.value.trim()||(approved&&!controls.text.value.trim())){message.textContent='Preencha identificação, justificativa e texto do exemplo.';return;}
    const payload={id:item.id,actor:actor.value.trim(),note:note.value.trim(),approved};
    if(approved){payload.text=controls.text.value.trim();payload.classification=Object.fromEntries(Object.keys(labels).map(f=>[f,controls[f].value.trim()||null]));}
    busy=true;const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
    try{await onAction(operation,payload);message.textContent='Decisão registrada.';buttons.forEach(b=>b.remove());}
    catch(error){message.textContent=error.message;busy=false;buttons.forEach(b=>b.disabled=false);}
  }
  form.addEventListener('submit',e=>e.preventDefault());
  if(item.status==='pending') {
    const approve=el('button','Aprovar para avaliação');approve.type='button';approve.addEventListener('click',()=>act('review',true));
    const reject=el('button','Rejeitar');reject.type='button';reject.className='secondary';reject.addEventListener('click',()=>act('review',false));form.append(approve,reject);
  } else {const retire=el('button','Retirar de uso ou da avaliação');retire.type='button';retire.className='secondary';retire.addEventListener('click',()=>act('retire'));form.append(retire);}
  return card;
}
