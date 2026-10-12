import { api } from './api.js';
const $ = selector => document.querySelector(selector);
const escape = value => { const span=document.createElement('span'); span.textContent=String(value??''); return span.innerHTML; };
const number = value => Number(value||0).toLocaleString('pt-BR');
const date = value => value ? new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(value)) : '—';
const labels = {draft:'Rascunho',scheduled:'Agendada',running:'Em andamento',paused:'Pausada',completed:'Envio concluído',cancelled:'Cancelada',pending:'Pendente',processing:'Processando',sent:'Enviada',delivered:'Entregue',read:'Lida',failed:'Falha'};
const rate = item => Number(item.sent) ? `${(Number(item.delivered)/Number(item.sent)*100).toFixed(1)}%` : '—';
const notify = message => { $('#toast').textContent=message; $('#toast').classList.remove('hidden'); setTimeout(()=>$('#toast').classList.add('hidden'),5000); };
function indicators(item) {
  return [['Campanhas',item.campaigns],['Destinatários',item.total],['Enviadas',item.sent],['Entregues',item.delivered],['Lidas',item.readCount],['Falhas',item.failed]].map(([label,value])=>`<article class="campaign-metric"><span>${label}</span><strong>${number(value)}</strong></article>`).join('');
}
function actionButtons(item,isAdmin=false) {
  const deletion=isAdmin&&item.status==='completed'?`<button class="campaign-delete" type="button" data-delete-campaign="${escape(item.id)}" title="Excluir campanha" aria-label="Excluir campanha"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg></button>`:'';
  return `${deletion}<button data-detail="${escape(item.id)}">Detalhes</button>${['running','scheduled'].includes(item.status)?`<button data-action="pause" data-id="${escape(item.id)}">Pausar</button>`:''}${item.status==='paused'?`<button data-action="resume" data-id="${escape(item.id)}">Retomar</button>`:''}${['running','scheduled','paused'].includes(item.status)?`<button data-action="cancel" data-id="${escape(item.id)}">Cancelar</button>`:''}`;
}
export function createCampaignDashboard(onReuse,getUser=()=>null) {
  let page=1, pages=1, busy=false, timer, report=null, reportPage=1, reportPages=1, tab='summary', reportSearch='', reportStatus='', reportVersion=0, reportTimer;
  function filters() { const query=new URLSearchParams({page:String(page)}); for(const [key,id] of [['search','campaign-search'],['status','campaign-status-filter'],['from','campaign-from'],['to','campaign-to']]) if($(`#${id}`).value) query.set(key,$(`#${id}`).value); return query; }
  $('#campaign-list').addEventListener('click',async event=>{
    const button=event.target.closest('[data-delete-campaign]');if(!button||getUser()?.role!=='admin')return;
    if(!confirm('Excluir esta campanha e seus relatórios de destinatários? As mensagens nas conversas serão preservadas.'))return;
    button.disabled=true;
    try{await api(`/api/campaigns/${encodeURIComponent(button.dataset.deleteCampaign)}`,{method:'DELETE'});await load();notify('Campanha excluída.');}
    catch(error){notify(error.message);}finally{button.disabled=false;}
  });
  async function load() {
    if(busy) return;
    busy=true;
    try {
      const query=filters(); const data=await api(`/api/campaigns/dashboard?${query}`);
      if(query.toString()!==filters().toString()) { setTimeout(()=>load().catch(error=>notify(error.message)),0); return; }
      page=data.page; pages=data.pages;
      $('#campaign-metrics').innerHTML=indicators(data.summary);
      $('#campaign-active').innerHTML=data.active.length?data.active.map(item=>{
        const processed=Number(item.total)-Number(item.pending); const percent=item.total?Math.round(processed/item.total*100):0;
        return `<article class="campaign-card"><div><h3>${escape(item.name)}</h3><small>${escape(item.templateName)} · ${item.delaySeconds}s por mensagem</small></div><span class="campaign-status ${item.status}">${labels[item.status]}</span><div><div class="campaign-progress"><i style="width:${percent}%"></i></div><div class="campaign-stats"><span>${number(processed)}/${number(item.total)} processados</span><span>${number(item.pending)} pendentes</span></div></div><div class="campaign-actions">${actionButtons(item,getUser()?.role==='admin')}</div></article>`;
      }).join(''):'<div class="empty">Nenhuma campanha ativa.</div>';
      $('#campaign-list').innerHTML=data.items.length?`<div class="dashboard-table-wrap"><table class="campaign-history"><thead><tr><th>Campanha</th><th>Data de criação</th><th>Status</th><th>Destinatários</th><th>Entregues</th><th>Lidas</th><th>Falhas</th><th title="Entregues ÷ enviadas">Entrega</th><th>Ações</th></tr></thead><tbody>${data.items.map(item=>`<tr><td data-label="Campanha"><strong>${escape(item.name)}</strong><small>${escape(item.templateName)}</small><small>${escape(item.createdByName||'')}</small></td><td data-label="Criada em">${date(item.createdAt)}</td><td data-label="Status"><span class="campaign-status ${item.status}">${labels[item.status]}</span></td><td data-label="Destinatários">${number(item.total)}</td><td data-label="Entregues">${number(item.delivered)}</td><td data-label="Lidas">${number(item.readCount)}</td><td data-label="Falhas" class="${Number(item.failed)?'recipient-error':''}">${number(item.failed)}</td><td data-label="Entrega">${rate(item)}</td><td><div class="campaign-actions">${actionButtons(item,getUser()?.role==='admin')}</div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Nenhuma campanha encontrada para estes filtros.</div>';
      $('#campaign-page-info').textContent=`Página ${page} de ${pages} · ${number(data.total)} campanhas`;
      $('#campaign-previous').disabled=page<=1; $('#campaign-next').disabled=page>=pages;
      $('#campaign-updated').textContent=`Atualizado às ${new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}).format(new Date())}`;
    } catch(error) {
      $('#campaign-updated').textContent='Falha ao atualizar o histórico';
      if(!$('#campaign-list .campaign-history')) $('#campaign-list').innerHTML='<div class="empty">Não foi possível carregar o histórico. Clique em Atualizar para tentar novamente.</div>';
      throw error;
    } finally {busy=false;}
  }
  function renderReport() {
    $('#detail-campaign-name').textContent=report.name;
    const controls=`<div class="report-actions"><a href="/api/campaigns/${encodeURIComponent(report.id)}/export" download>Exportar CSV completo</a><button data-reuse="all">Duplicar campanha</button><button data-reuse="failed" ${!Number(report.failed)?'disabled':''}>Nova campanha com falhas</button></div>`;
    const navigation=`<div class="report-tabs" role="tablist">${[['summary','Resumo'],['recipients','Destinatários'],['errors','Falhas']].map(([key,label])=>`<button role="tab" aria-selected="${tab===key}" data-report-tab="${key}">${label}</button>`).join('')}</div>`;
    let body;
    if(tab==='summary') body=`<div class="campaign-metrics report-metrics">${indicators(report).replace(/<article class="campaign-metric"><span>Campanhas<\/span>[\s\S]*?<\/article>/,'')}</div><div class="report-summary"><p><span class="campaign-status ${report.status}">${labels[report.status]}</span> · ${escape(report.templateName)} · ${escape(report.templateLanguage)}</p><p>${escape(report.description||'')}</p><dl><div><dt>Criada por</dt><dd>${escape(report.createdByName||'—')}</dd></div><div><dt>Agendada para</dt><dd>${date(report.scheduledFor)}</dd></div><div><dt>Início</dt><dd>${date(report.startedAt)}</dd></div><div><dt>Fim do processamento</dt><dd>${date(report.completedAt)}</dd></div><div><dt>Taxa de entrega</dt><dd>${rate(report)} · entregues ÷ enviadas</dd></div><div><dt>Pendentes / canceladas</dt><dd>${number(report.pending)} / ${number(report.cancelled)}</dd></div></dl><p class="dashboard-note">Enviadas inclui entregues e lidas. Entregues inclui lidas. Leitura depende da confirmação recebida pelo WhatsApp; não representa todas as pessoas que visualizaram.</p><h3>Mensagem enviada</h3><pre class="campaign-preview">${escape(report.templatePreview||'Prévia indisponível.')}</pre></div>`;
    else if(tab==='errors') body=`<p class="dashboard-note">Principais motivos de falha · até 20 grupos. Uma falha de entrega não comprova que o número não tem WhatsApp.</p><div class="report-error-list">${report.errors.length?report.errors.map(error=>`<article><strong>${number(error.total)} destinatário(s)</strong><p>${escape(error.reason)}</p></article>`).join(''):'<div class="empty">Nenhuma falha registrada.</div>'}</div><button data-show-failed>Ver destinatários com falha</button><a class="report-link" href="/api/campaigns/${encodeURIComponent(report.id)}/export?failed=true" download>Exportar falhas</a>`;
    else body=`<div class="report-filters"><label>Buscar destinatário<input id="report-search" type="search" value="${escape(reportSearch)}" placeholder="Nome ou telefone"></label><label>Status<select id="report-status">${[['','Todos'],['pending','Pendente'],['processing','Processando'],['sent','Enviada'],['delivered','Entregue (inclui lidas)'],['read','Lida'],['failed','Falha'],['cancelled','Cancelada']].map(([key,label])=>`<option value="${key}" ${reportStatus===key?'selected':''}>${label}</option>`).join('')}</select></label></div><div class="dashboard-table-wrap"><table class="recipient-table"><thead><tr><th>Destinatário</th><th>Telefone</th><th>Status</th><th>Enviada</th><th>Entregue</th><th>Lida</th><th>Erro</th></tr></thead><tbody>${report.recipients.length?report.recipients.map(item=>`<tr><td>${escape(item.name||'—')}</td><td>${escape(item.phone)}</td><td>${labels[item.status]||escape(item.status)}</td><td>${date(item.sentAt)}</td><td>${date(item.deliveredAt)}</td><td>${date(item.readAt)}</td><td class="recipient-error">${escape(item.errorMessage||'—')}</td></tr>`).join(''):'<tr><td colspan="7">Nenhum destinatário encontrado.</td></tr>'}</tbody></table></div><div class="dashboard-pagination"><button data-report-page="-1" ${reportPage<=1?'disabled':''}>← Anterior</button><span>Página ${reportPage} de ${reportPages} · ${number(report.recipientTotal)} destinatários</span><button data-report-page="1" ${reportPage>=reportPages?'disabled':''}>Próxima →</button></div>`;
    $('#campaign-detail-content').innerHTML=controls+navigation+body;
  }
  async function refreshReport(id=report?.id) {
    if(!id)return;
    const version=++reportVersion; const query=new URLSearchParams({page:String(reportPage)});
    if(reportSearch)query.set('search',reportSearch); if(reportStatus)query.set('status',reportStatus);
    const item=await api(`/api/campaigns/${encodeURIComponent(id)}/report?${query}`);
    if(version!==reportVersion)return;
    const focused=document.activeElement?.id==='report-search'; const position=focused?document.activeElement.selectionStart:null;
    report=item; reportPage=item.page; reportPages=item.pages; renderReport();
    if(focused&&$('#report-search')) {$('#report-search').focus(); if(position!==null)$('#report-search').setSelectionRange(position,position);}
  }
  async function open(id) {reportPage=1;tab='summary';reportSearch='';reportStatus='';await refreshReport(id);if(!$('#campaign-detail').open)$('#campaign-detail').showModal();}
  for(const id of ['campaign-search','campaign-status-filter','campaign-from','campaign-to']) $(`#${id}`).addEventListener(id==='campaign-search'?'input':'change',()=>{page=1;clearTimeout(timer);timer=setTimeout(()=>load().catch(error=>notify(error.message)),250);});
  $('#clear-campaign-filters').addEventListener('click',()=>{for(const id of ['campaign-search','campaign-status-filter','campaign-from','campaign-to'])$(`#${id}`).value='';page=1;void load().catch(error=>notify(error.message));});
  $('#campaign-previous').addEventListener('click',()=>{if(busy||page<=1)return;page--;void load().catch(error=>notify(error.message));});
  $('#campaign-next').addEventListener('click',()=>{if(busy||page>=pages)return;page++;void load().catch(error=>notify(error.message));});
  $('#campaign-active').addEventListener('click',async event=>{const detail=event.target.closest('[data-detail]');const action=event.target.closest('[data-action]');try{if(detail)await open(detail.dataset.detail);else if(action){action.disabled=true;await api(`/api/campaigns/${action.dataset.id}/${action.dataset.action}`,{method:'POST'});await load();}}catch(error){notify(error.message);}finally{if(action)action.disabled=false;}});
  $('#campaign-detail-content').addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button)return;
    try {
      if(button.dataset.reportTab){tab=button.dataset.reportTab;renderReport();}
      else if(button.hasAttribute('data-show-failed')){tab='recipients';reportStatus='failed';reportPage=1;await refreshReport();}
      else if(button.dataset.reportPage){reportPage=Math.max(1,Math.min(reportPages,reportPage+Number(button.dataset.reportPage)));await refreshReport();}
      else if(button.dataset.reuse){button.disabled=true;const data=await api(`/api/campaigns/${encodeURIComponent(report.id)}/export?format=json${button.dataset.reuse==='failed'?'&failed=true':''}`);await onReuse(report,data.items,button.dataset.reuse==='failed');$('#campaign-detail').close();}
    } catch(error){notify(error.message);} finally {if(button.dataset.reuse)button.disabled=false;}
  });
  $('#campaign-detail-content').addEventListener('input',event=>{if(event.target.id!=='report-search')return;reportSearch=event.target.value;reportPage=1;reportVersion++;clearTimeout(reportTimer);reportTimer=setTimeout(()=>refreshReport().catch(error=>notify(error.message)),300);});
  $('#campaign-detail-content').addEventListener('change',event=>{if(event.target.id!=='report-status')return;reportStatus=event.target.value;reportPage=1;void refreshReport().catch(error=>notify(error.message));});
  $('#campaign-detail').addEventListener('close',()=>{reportVersion++;clearTimeout(reportTimer);});
  setInterval(()=>{if(!document.hidden&&$('#campaign-detail').open)void refreshReport().catch(error=>notify(error.message));},15000);
  return {load,open};
}
