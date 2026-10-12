import { initCarouselTemplateEditor } from './carousel-template-editor.js?v=1';
import { api } from './api.js';
import { createCarouselEditor } from './campaign-carousel.js?v=5';
import { createCampaignDashboard } from './campaign-dashboard.js?v=3';
const $ = selector => document.querySelector(selector);
const state = { me: null, campaigns: [], contacts: [], templates: [], imported: [], selected: new Map() };
const dashboard = createCampaignDashboard(reuseCampaign,()=>state.me);
const carouselEditor = createCarouselEditor(toast);
const escapeHtml = value => { const node = document.createElement('div'); node.textContent = String(value ?? ''); return node.innerHTML; };
const statusLabel = status => ({ draft: 'Rascunho', scheduled: 'Agendada', running: 'Em andamento', paused: 'Pausada', completed: 'Concluída', cancelled: 'Cancelada' })[status] || status;
const dateTime = value => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
function toast(message) { $('#toast').textContent = message; $('#toast').classList.remove('hidden'); setTimeout(() => $('#toast').classList.add('hidden'), 3500); }
function showView(view) { $('#campaign-list-view').classList.toggle('hidden', view !== 'list'); $('#campaign-create-view').classList.toggle('hidden', view !== 'create'); document.querySelectorAll('.campaign-tab').forEach(item => item.classList.toggle('active', item.dataset.view === view)); $('#campaign-title').textContent = view === 'create' ? 'Criar campanha' : 'Campanhas'; $('#open-create').classList.toggle('hidden', view === 'create'); document.body.classList.toggle('creating-campaign', view === 'create'); }

async function reuseCampaign(campaign, recipients, failedOnly) {
  if (!recipients.length) throw new Error('Nenhum destinatário disponível para reutilizar.');
  if (recipients.length > 5000) throw new Error('O formulário aceita até 5.000 destinatários.');
  const index=state.templates.findIndex(item=>item.name===campaign.templateName&&item.language===campaign.templateLanguage);
  if (index<0) throw new Error('O template original não está disponível entre os aprovados.');
  $('#campaign-form').reset(); state.selected.clear();
  state.imported=recipients.map(item=>({phone:item.phone,...(item.name?{name:item.name}:{})}));
  $('#campaign-name').value=`${failedOnly?'Falhas':'Cópia'} · ${campaign.name}`.slice(0,160);
  $('#campaign-description').value=campaign.description||'';
  $('#campaign-delay').value=campaign.delaySeconds;
  $('#campaign-template').value=String(index);renderTemplateFields();
  const components=typeof campaign.templateComponents==='string'?JSON.parse(campaign.templateComponents):campaign.templateComponents||[];
  const textParameters=components.filter(component=>['header','body'].includes(component.type)).flatMap(component=>component.parameters||[]);
  const buttonParameters=components.filter(component=>component.type==='button'&&component.sub_type==='url').flatMap(component=>component.parameters||[]);
  const parameters=[...textParameters,...buttonParameters];
  carouselEditor.restore(components);
  templateVariables(selectedTemplate()).forEach((field,index)=>{const input=document.querySelector(`[data-template-parameter="${index}"]`);if(input)input.value=parameters[index]?.text||'';});
  const commerce=components.find(component=>component.type==='button'&&['mpm','catalog'].includes(component.sub_type));
  const action=commerce?.parameters?.find(parameter=>parameter.type==='action')?.action;
  if($('#catalog-product-ids')) $('#catalog-product-ids').value=(action?.sections?.flatMap(section=>section.product_items||[]).map(item=>item.product_retailer_id)||[action?.thumbnail_product_retailer_id].filter(Boolean)).join('\n');
  if($('#catalog-section-title')&&action?.sections?.[0]?.title)$('#catalog-section-title').value=action.sections[0].title;
  $('#import-summary').textContent=`${recipients.length} destinatários reaproveitados. Revise a lista antes de enviar.`;
  renderContacts();updateRecipientSummary();showView('create');
  toast('Configuração copiada. Revise os campos e inicie quando desejar.');
}

async function init() {
  state.me = (await api('/api/auth/me')).user; if (state.me.role === 'agent') return location.replace('/');
  initCarouselTemplateEditor(state.me, toast, async()=>{ await refreshCarouselTemplateState(); document.querySelector("#refresh-campaign-templates").click(); });
  await loadCampaigns();
  const results = await Promise.allSettled([api('/api/templates'), loadContacts()]);
  if (results[0].status === 'fulfilled') {
    state.templates = results[0].value.items; renderTemplates();
  } else {
    $('#campaign-template').innerHTML = '<option value="">Não foi possível carregar os templates</option>';
    toast(results[0].reason.message);
  }
  if (results[1].status === 'rejected') toast(results[1].reason.message);
  void refreshCarouselTemplateState();
}
async function refreshCarouselTemplateState() {
  try {
    const data=await api('/api/campaigns/carousel/template');
    const labels={APPROVED:'aprovado e disponível para campanhas',PENDING:'aguardando aprovação da Meta',REJECTED:'recusado pela Meta',PAUSED:'pausado pela Meta',DISABLED:'desativado pela Meta',NOT_CREATED:'ainda não cadastrado'};
    $('#carousel-template-state').textContent=`Carrossel ${data.name||'ofertas_produtos_carrossel'}: ${labels[data.status]||data.status||'consulte o estado no Gerenciador do WhatsApp'}.`;
  } catch { $('#carousel-template-state').textContent='Não foi possível consultar o estado do carrossel. Atualize os modelos para tentar novamente.'; }
}
$('#refresh-campaign-templates').addEventListener('click',async event=>{
  const button=event.currentTarget;button.disabled=true;const selected=selectedTemplate();
  try{state.templates=(await api('/api/templates')).items;renderTemplates();
    const index=selected?state.templates.findIndex(item=>item.name===selected.name&&item.language===selected.language):-1;
    if(index>=0)$('#campaign-template').value=String(index);else renderTemplateFields();
    await refreshCarouselTemplateState();
  }catch(error){toast(error.message);}finally{button.disabled=false;}
});
async function loadContacts(search='') { const data=await api(`/api/contacts?limit=50&page=1&search=${encodeURIComponent(search)}`); state.contacts=data.items; renderContacts(); }
async function loadCampaigns() { return dashboard.load(); }
function renderContacts(query = '') { const term = query.toLowerCase(); const items = state.contacts.filter(item => `${item.name||''} ${item.profileName||''} ${item.phone||''}`.toLowerCase().includes(term)); $('#campaign-contacts').innerHTML = items.length ? items.map(item => `<label class="contact-choice"><input type="checkbox" data-contact-phone="${escapeHtml(item.phone)}" ${state.selected.has(String(item.phone))?'checked':''}><span>${escapeHtml(item.name||item.profileName||item.phone)}<small>${escapeHtml(item.phone)}</small></span></label>`).join('') : '<div class="empty">Nenhum contato encontrado.</div>'; }
function renderTemplates() { $('#campaign-template').innerHTML = '<option value="">Selecione um template</option>'+state.templates.map((item,index)=>`<option value="${index}">${escapeHtml(item.name)} · ${escapeHtml(item.language)} · ${escapeHtml(item.category)}</option>`).join(''); }
function templateVariableNames(text='') { const names=[...new Set([...String(text).matchAll(/\{\{(\d+|[a-z_][a-z0-9_]*)\}\}/g)].map(match=>match[1]))];return names.every(name=>/^\d+$/.test(name))?Array.from({length:Math.max(0,...names.map(Number))},(_,index)=>String(index+1)):names; }
function variableCount(text='') { return templateVariableNames(text).length; }
function selectedTemplate() { const index=$('#campaign-template').value; return index===''?null:state.templates[Number(index)]; }
function templateVariables(template) { const fields=[]; for(const component of template?.components||[]){const type=String(component.type||'').toUpperCase();if(['HEADER','BODY'].includes(type)){const names=templateVariableNames(component.text);const count=names.length;const namedExamples=component.example?.[type==='BODY'?'body_text_named_params':'header_text_named_params']||[];const examples=type==='BODY'?component.example?.body_text?.[0]||[]:component.example?.header_text||[];for(let index=0;index<count;index++)fields.push({automatic:names[index]==='nome',label:`${type==='BODY'?'Mensagem':'Cabeçalho'} {{${names[index]}}}`,placeholder:namedExamples.find(item=>item.param_name===names[index])?.example||examples[index]||`Valor de {{${names[index]}}}`});}if(type==='BUTTONS')for(const button of component.buttons||[]){if(String(button.type||'').toUpperCase()!=='URL')continue;const count=variableCount(button.url);for(let index=0;index<count;index++)fields.push({label:`Link do botão {{${index+1}}}`,placeholder:'Parte dinâmica do link'});}}return fields;}
function commerceButton(template){for(const component of template?.components||[])if(String(component.type).toUpperCase()==='BUTTONS'){const button=(component.buttons||[]).find(item=>['MPM','CATALOG'].includes(String(item.type).toUpperCase()));if(button)return String(button.type).toUpperCase();}return null;}
function renderTemplateFields() { const template=selectedTemplate(); const fields=templateVariables(template),commerce=commerceButton(template);let html=fields.map((field,index)=>field.automatic?'<p class="template-no-variables">{{nome}} ser? preenchido com o nome de cada destinat?rio (CSV ou perfil do contato).</p>':`<label>${escapeHtml(field.label)}<input data-template-parameter="${index}" required placeholder="${escapeHtml(field.placeholder)}"></label>`).join('');if(commerce){html+=`<div class="commerce-fields"><label>${commerce==='MPM'?'IDs dos produtos do catálogo':'ID do produto de capa'}<textarea id="catalog-product-ids" rows="3" required placeholder="101&#10;103"></textarea><small>${commerce==='MPM'?'Informe até 30 IDs, separados por linha ou vírgula. O primeiro será a capa.':'Informe o retailer ID do produto.'}</small></label>${commerce==='MPM'?'<label>Título da seção<input id="catalog-section-title" maxlength="24" value="Produtos" required></label>':''}</div>`;}if(!fields.length&&!commerce)html='<p class="template-no-variables">Este template não possui variáveis para preencher.</p>';$('#campaign-template-fields').innerHTML=html; carouselEditor.render(template); if(template?.name==='ofertas_produtos_carrossel'){const nameInput=document.querySelector('[data-template-parameter="0"]');if(nameInput)nameInput.value='{{nome}}';} updatePreview(); }
function updatePreview() { const template=selectedTemplate(); if(!template){$('#campaign-template-preview').classList.add('hidden');return;} const values=templateVariables(template).map((field,index)=>field.automatic?(allRecipients()[0]?.name||'{{nome}}'):(document.querySelector(`[data-template-parameter="${index}"]`)?.value||'')); let cursor=0; const lines=[]; for(const component of template.components||[]){const type=String(component.type||'').toUpperCase();if(['HEADER','BODY'].includes(type)&&component.text){const names=templateVariableNames(component.text);const count=names.length;const scoped=values.slice(cursor,cursor+count);cursor+=count;lines.push(component.text.replace(/\{\{(\d+|[a-z_][a-z0-9_]*)\}\}/g,(_,n)=>scoped[names.indexOf(n)]||`{{${n}}}`));}else if(type==='FOOTER'&&component.text)lines.push(component.text);} $('#campaign-template-preview').textContent=lines.join('\n\n'); $('#campaign-template-preview').classList.remove('hidden'); carouselEditor.preview(); }
function pastedRecipients() { return $('#number-list').value.split(/\r?\n|,|;/).map(phone=>phone.trim()).filter(Boolean).map(phone=>({phone})); }
function allRecipients() { const merged=[...state.selected.values(),...state.imported,...pastedRecipients()];const unique=new Map();for(const item of merged){let phone=String(item.phone).replace(/\D/g,'');if(phone.length===10||phone.length===11)phone='55'+phone;const previous=unique.get(phone);unique.set(phone,{...previous,...item,phone,name:item.name||previous?.name});}return [...unique.values()].filter(item=>item.phone); }
function updateRecipientSummary(){ updatePreview(); $('#recipient-summary').textContent=`${allRecipients().length} destinatários selecionados`; }
async function importFile(file){const form=new FormData();form.append('file',file);const data=await api('/api/campaigns/import',{method:'POST',body:form});state.imported=data.items;$('#import-summary').textContent=`${data.items.length} válidos · ${data.duplicates} duplicados · ${data.invalid.length} inválidos`;updateRecipientSummary();}
async function openDetail(id) { return dashboard.open(id); }
let contactSearchTimer; document.querySelectorAll('.campaign-tab').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.view))); $('#open-create').addEventListener('click',()=>showView('create')); $('#cancel-create').addEventListener('click',()=>showView('list')); $('#refresh-campaigns').addEventListener('click',()=>loadCampaigns().catch(error=>toast(error.message))); $('#contact-filter').addEventListener('input',event=>{clearTimeout(contactSearchTimer);contactSearchTimer=setTimeout(()=>loadContacts(event.target.value).catch(error=>toast(error.message)),250);}); $('#campaign-contacts').addEventListener('change',event=>{const input=event.target.closest('[data-contact-phone]');if(!input)return;const item=state.contacts.find(c=>String(c.phone)===input.dataset.contactPhone);if(input.checked)state.selected.set(input.dataset.contactPhone,{phone:item.phone,name:item.profileName||item.name});else state.selected.delete(input.dataset.contactPhone);updateRecipientSummary();}); $('#number-list').addEventListener('input',updateRecipientSummary); $('#campaign-file').addEventListener('change',event=>event.target.files[0]&&importFile(event.target.files[0]).catch(error=>toast(error.message))); $('#campaign-template').addEventListener('change',renderTemplateFields); $('#campaign-template-fields').addEventListener('input',updatePreview);
$('#campaign-form').addEventListener('submit',async event=>{event.preventDefault();const template=selectedTemplate(),recipients=allRecipients();if(!template)return toast('Selecione um template.');if(!recipients.length)return toast('Adicione destinatários.');let carouselCards;try{carouselCards=carouselEditor.serialize();}catch(error){return toast(error.message);}const body={carouselCards,name:$('#campaign-name').value,description:$('#campaign-description').value||undefined,templateName:template.name,templateLanguage:template.language,parameters:[...document.querySelectorAll('[data-template-parameter]')].map(input=>input.value),catalogProductIds:$('#catalog-product-ids')?.value.split(/[\r\n,;]+/).map(value=>value.trim()).filter(Boolean)||[],catalogSectionTitle:$('#catalog-section-title')?.value||'Produtos',delaySeconds:Number($('#campaign-delay').value),scheduledFor:$('#campaign-schedule').value?new Date($('#campaign-schedule').value).toISOString():undefined,recipients,saveContacts:$('#save-contacts').checked};$('#save-campaign').disabled=true;try{await api('/api/campaigns/create',{method:'POST',body:JSON.stringify(body)});event.target.reset();state.selected.clear();state.imported=[];renderContacts();renderTemplateFields();updateRecipientSummary();showView('list');await loadCampaigns();toast('Campanha criada.');}catch(error){toast(error.message);}finally{$('#save-campaign').disabled=false;}});
$('#campaign-list').addEventListener('click',async event=>{const detail=event.target.closest('[data-detail]');if(detail)return openDetail(detail.dataset.detail).catch(error=>toast(error.message));const button=event.target.closest('[data-action]');if(!button)return;try{await api(`/api/campaigns/${button.dataset.id}/${button.dataset.action}`,{method:'POST'});await loadCampaigns();toast('Campanha atualizada.');}catch(error){toast(error.message);}}); $('#close-campaign-detail').addEventListener('click',()=>$('#campaign-detail').close());
init().catch(error=>toast(error.message)); setInterval(()=>{if(!document.hidden&&$('#campaign-list-view')&&!$('#campaign-list-view').classList.contains('hidden'))void loadCampaigns().catch(error=>toast(error.message));},15000);
