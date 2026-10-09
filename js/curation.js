import { curationOperation } from './api.js';
import { curationCard } from './curation-card.mjs';
const status=document.querySelector('#status'),items=document.querySelector('#items'),filter=document.querySelector('#filter'),more=document.querySelector('#more');let offset=0;
async function load(append=false){
  if(!append){offset=0;items.replaceChildren();}status.textContent='Carregando correções…';
  try{const data=await curationOperation('list',{status:filter.value,offset});
    data.items.forEach(item=>items.append(curationCard(document,item,async(op,payload)=>{await curationOperation(op,payload);})));offset+=data.items.length;more.hidden=!data.has_more;
    status.textContent=offset?`${offset} correções carregadas. Atualize a lista após revisar.`:'Nenhuma correção nesta situação.';
  }catch(e){status.textContent=e.message;}
}
filter.addEventListener('change',()=>load());document.querySelector('#refresh').addEventListener('click',()=>load());more.addEventListener('click',()=>load(true));
document.querySelector('#export').addEventListener('click',async()=>{
  try{const data=await curationOperation('export');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='catalogue-for-evaluation.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent='Catálogos exportados para avaliação.';}catch(e){status.textContent=e.message;}
});
document.querySelector('#publish-form').addEventListener('submit',async e=>{
  e.preventDefault();const button=document.querySelector('#publish');button.disabled=true;
  try{const file=document.querySelector('#report').files[0];if(!file||file.size>2000000)throw new Error('Selecione um relatório JSON de até 2 MB.');
    const report=JSON.parse(await file.text());await curationOperation('publish',{actor:document.querySelector('#publisher').value.trim(),report});
    await load();status.textContent='Exemplos publicados. Serão considerados nas próximas análises pertinentes.';
  }catch(e){status.textContent=e instanceof SyntaxError?'Relatório JSON inválido.':e.message;}finally{button.disabled=false;}
});
await load();
