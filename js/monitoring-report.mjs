const actions = { clarify: 'Esclarecimento', simple_confirmation: 'Confirmação simplificada', detailed_review: 'Revisão detalhada' };
const rate = (numerator, denominator) => denominator ? `${numerator}/${denominator} (${(100*numerator/denominator).toFixed(1)}%)` : 'Sem amostra';
const duration = ms => ms === null || ms === undefined ? 'Sem amostra' : `${(ms/1000).toFixed(1)} s`;
export function renderMonitoring(document, target, data) {
  target.replaceChildren();
  const el = (tag, text, cls) => { const n=document.createElement(tag); if(text!==undefined) n.textContent=String(text); if(cls) n.className=cls; return n; };
  const t=data.totals;
  target.append(el('p', data.policy.simplified_review_enabled ? 'Confirmação simplificada disponível para casos explícitos e resolvidos. Registro automático desativado.' : 'Confirmação simplificada suspensa. Revisão completa obrigatória. Registro automático desativado.'));
  target.append(el('p', `Política ${data.policy.version}, revisão ${data.policy.revision}. Todos os casos exigem confirmação; ainda faltam avaliação de domínio, piloto e identificação verificada dos revisores.`, 'coverage'));
  if (!t.attempts) target.append(el('p','Nenhuma análise acompanhada neste período.'));
  const metrics=el('div',undefined,'metrics');
  for(const [label,value] of [
    ['Tentativas de análise',t.attempts],['Falhas / tentativas',rate(t.failures,t.attempts)],
    ['Pedidos de esclarecimento',t.clarification_requests],['Confirmações simplificadas propostas',t.simple_confirmations],
    ['Revisões detalhadas propostas',t.detailed_reviews],['Percepções confirmadas',t.confirmed],
    ['Com ajustes / confirmadas',rate(t.corrected,t.confirmed)],['Tempo de análise (95% das tentativas)',duration(t.p95_analysis_ms)],
    ['Turnos do usuário por percepção confirmada',t.average_turns_confirmed===null?'Sem amostra':Number(t.average_turns_confirmed).toFixed(1)],
    ['Tempo decorrido até confirmar (inclui espera)',duration(t.average_elapsed_until_confirmation_ms)],
  ]) {const n=el('div',undefined,'metric');n.append(el('span',label),el('strong',value));metrics.append(n);}
  target.append(metrics);
  if(data.alerts.failure_rate_exceeded) target.append(el('p','Atenção: mais de 10% de falhas em pelo menos 20 tentativas. Investigue a disponibilidade antes de ampliar o uso.','status error'));
  if(data.alerts.correction_rate_exceeded) target.append(el('p','Atenção: mais de 10% de ajustes em pelo menos 20 confirmações. Revise os grupos afetados e considere suspender a simplificação.','status error'));
  target.append(el('h2','Resultados por grupo'));
  const wrap=el('div',undefined,'table-wrap'),table=el('table'),head=el('thead'),hr=el('tr');
  for(const label of ['Modelo / referências','Natureza','Encaminhamento','Tentativas','Falhas','Ajustadas / confirmadas']) hr.append(el('th',label));
  head.append(hr);table.append(head);const body=el('tbody');
  for(const g of data.groups) {const row=el('tr'); for(const value of [`${g.model} · ${g.prompt_version??'—'} · política ${g.policy_revision??'—'} · ${g.examples_version??'—'}`,g.category??'Não determinada',actions[g.action]??'Falha',g.attempts,g.failures,rate(g.corrected,g.confirmed)]) row.append(el('td',value));body.append(row);}
  table.append(body);wrap.append(table);target.append(wrap);
  target.append(el('h2','Campos ajustados'));
  if(!data.field_corrections.length) target.append(el('p','Nenhum ajuste observado nas confirmações acompanhadas.'));
  const labels={tipo:'Tipo',processo:'Processo',subprocesso:'Subprocesso',sistema:'Sistema',produto:'Produto',categoria_problema:'Natureza',summary:'Resumo'};
  for(const f of data.field_corrections) target.append(el('p',`${labels[f.field]??f.field}: ${f.corrections}`));
}
