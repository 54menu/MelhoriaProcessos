import { fetchClassificationMonitoring } from './api.js';
import { renderMonitoring } from './monitoring-report.mjs';
const status=document.querySelector('#status'),report=document.querySelector('#report'),button=document.querySelector('#refresh'),days=document.querySelector('#days');
async function refresh(){
  button.disabled=true;days.disabled=true;status.textContent='Consultando acompanhamento…';status.className='status';
  try {const data=await fetchClassificationMonitoring(Number(days.value));renderMonitoring(document,report,data);status.textContent=`Atualizado em ${new Date(data.generated_at).toLocaleString('pt-BR')}.`;}
  catch(error){report.replaceChildren();status.textContent=error.message;status.className='status error';}
  finally{button.disabled=false;days.disabled=false;}
}
button.addEventListener('click',refresh);days.addEventListener('change',refresh);refresh();
