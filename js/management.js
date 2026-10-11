import { managementReview } from './api.js';
import { createReview } from './review.mjs';
const items=document.querySelector('#items'),status=document.querySelector('#status'),refresh=document.querySelector('#refresh'),more=document.querySelector('#more');
let offset=0,busy=false;
async function load(reset=false){
  if(busy)return;busy=true;refresh.disabled=more.disabled=true;
  if(reset){offset=0;items.replaceChildren();}status.textContent='Consultando relatos…';
  try{
    const response=await managementReview('list',{offset});
    for(const item of response.items){
      const session=item.analysis_sessions,p=session.proposed_interpretation;
      const wrapper=document.createElement('section'),original=document.createElement('details'),title=document.createElement('summary'),text=document.createElement('p');
      title.textContent='Relato original confirmado pelo usuário';text.textContent=session.original_text;original.append(title,text);wrapper.append(original);
      const card=createReview({document,data:{summary:p.interpretation,fields:p.fields,review_policy:{...p.review_policy,action:'detailed_review'}},
        onConfirm:async(classification,summary,reviewer)=>{
          await managementReview('review',{analysis_id:item.analysis_session_id,classification,summary,reviewer_label:reviewer});
          status.textContent='Classificação aprovada pelo gestor. Atualize a fila para consultar as pendências.';
        },onCancel:()=>{wrapper.remove();status.textContent='Revisão adiada. O relato continua pendente na fila.';}});
      wrapper.append(card);items.append(wrapper);
    }
    offset+=response.items.length;more.hidden=response.items.length<50;
    status.textContent=offset?`${offset} relato(s) carregado(s).`:'Nenhum relato aguardando revisão.';
  }catch(error){status.textContent=error.message;}
  finally{busy=false;refresh.disabled=more.disabled=false;}
}
refresh.addEventListener('click',()=>load(true));more.addEventListener('click',()=>load());load(true);
