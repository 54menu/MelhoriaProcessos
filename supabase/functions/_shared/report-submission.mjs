export function createSubmissionHandler(submit) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json; charset=utf-8' };
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
  return async request=>{
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(request.method!=='POST')return reply(405,{error:{message:'Use POST.'}});
    const payload=await request.json().catch(()=>null);
    if(!payload||payload.confirmed!==true||typeof payload.analysis_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.analysis_id)||Object.keys(payload).some(k=>!['analysis_id','confirmed'].includes(k)))return reply(400,{error:{message:'Confirme o resumo na conversa. Se a página estiver desatualizada, recarregue e tente novamente.'}});
    try {return reply(201,{submission_id:await submit(payload.analysis_id),status:'pending_management_review'});}
    catch(error){const expired=error?.message?.includes('analysis_session_unavailable');return reply(expired?409:503,{error:{message:expired?'Este resumo expirou. Retome a conversa para gerar outro.':'Não foi possível enviar o relato. Tente novamente.'}});}
  };
}
