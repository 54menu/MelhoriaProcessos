import { parseConfirmation } from './review-confirmation.mjs';
export function createManagementHandler(repository) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json; charset=utf-8' };
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
  return async request=>{
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(request.method!=='POST')return reply(405,{error:{message:'Use POST.'}});
    const p=await request.json().catch(()=>null);
    if(!p||!['list','review'].includes(p.operation))return reply(400,{error:{message:'Operação inválida.'}});
    try {
      if(p.operation==='list'){
        const offset=p.offset??0;if(!Number.isSafeInteger(offset)||offset<0)return reply(400,{error:{message:'Página inválida.'}});
        return reply(200,{items:await repository.list(offset)});
      }
      const args=parseConfirmation(p);if(!args)return reply(400,{error:{message:'Confira classificação, resumo e nome do gestor.'}});
      return reply(201,{perception_id:await repository.review(args),status:'reviewed'});
    }catch(error){const conflict=/analysis_session_unavailable|report_not_submitted/.test(error?.message??'');return reply(conflict?409:503,{error:{message:conflict?'O relato não está disponível para esta revisão. Atualize a lista.':'Não foi possível concluir a operação. Tente novamente.'}});}
  };
}
