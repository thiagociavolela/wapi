import { api } from './api.js';

export function initCarouselTemplateEditor(user, notify, refresh) {
  if(user.role!=='admin')return;
  const open=document.querySelector('#personalize-carousel');open.classList.remove('hidden');
  const dialog=document.createElement('dialog');dialog.className='carousel-template-dialog';
  dialog.innerHTML='<form><header><h2>Personalizar carrossel</h2><button type="button" data-close aria-label="Fechar">×</button></header><p data-state></p><p>Ao enviar, o modelo pode ficar indisponível para campanhas e conversas até a nova aprovação da Meta.</p><div data-fields></div><h3>Prévia</h3><div data-preview></div><p data-error role="alert"></p><label class="template-edit-confirm"><input type="checkbox" required> Entendo que esta alteração afeta o modelo compartilhado e requer nova aprovação.</label><footer><button type="button" data-close>Cancelar</button><button type="submit" class="primary">Enviar para aprovação</button></footer></form>';
  document.body.append(dialog);
  const $=selector=>dialog.querySelector(selector),form=$('form'),submit=$('[type="submit"]');
  const escape=value=>{const element=document.createElement('span');element.textContent=String(value??'');return element.innerHTML;};
  let template;
  const cards=()=>template.components.find(item=>item.type==='CAROUSEL')?.cards||[];
  function values(){return {body:$('[name="body"]').value,cardBodies:[...dialog.querySelectorAll('[data-card-body]')].map(input=>input.value),urlLabel:$('[name="urlLabel"]').value,replyLabel:$('[name="replyLabel"]').value};}
  function preview(){if(!template)return;const data=values();$('[data-preview]').innerHTML=`<p>${escape(data.body.replaceAll('{{1}}','Maria'))}</p><div class="template-edit-cards">${data.cardBodies.map((text,index)=>{const example=cards()[index].components.find(item=>item.type==='BODY')?.example?.body_text?.[0]||['Produto','R$ 99,00','Descrição'];return `<article><div class="template-edit-image">Imagem do produto ${index+1}</div><p>${escape(text.replace(/\{\{(\d+)\}\}/g,(_,n)=>example[Number(n)-1]||''))}</p><span>${escape(data.urlLabel)}</span><span>${escape(data.replyLabel)}</span></article>`;}).join('')}</div>`;}
  dialog.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>dialog.close()));
  form.addEventListener('input',preview);
  open.addEventListener('click',async()=>{
    open.disabled=true;
    try{
      template=(await api('/api/campaigns/carousel/template/edit')).template;
      form.reset();$('[data-error]').textContent='';
      const buttons=cards()[0]?.components.find(item=>item.type==='BUTTONS')?.buttons||[];
      const field=(name,label,text,max)=>`<label>${label}<textarea name="${name}" maxlength="${max}" required rows="3">${escape(text)}</textarea></label>`;
      $('[data-fields]').innerHTML=field('body','Mensagem principal · mantenha {{1}} (nome)',template.components.find(item=>item.type==='BODY')?.text,1024)+cards().map((card,index)=>`<label>Cartão ${index+1} · {{1}} produto, {{2}} preço, {{3}} descrição<textarea data-card-body maxlength="160" rows="3" required>${escape(card.components.find(item=>item.type==='BODY')?.text)}</textarea></label>`).join('')+`<div class="template-edit-buttons">${['URL','QUICK_REPLY'].map((type,index)=>`<label>${index?'Botão de resposta':'Botão de detalhes'}<input name="${index?'replyLabel':'urlLabel'}" maxlength="25" required value="${escape(buttons.find(item=>item.type===type)?.text)}"></label>`).join('')}</div><small>O formato das imagens, os links e as variáveis são preservados.</small>`;
      $('[data-state]').textContent=`${template.name} · ${template.language} · ${template.status}`;
      submit.disabled=!['APPROVED','REJECTED'].includes(template.status);
      if(submit.disabled)$('[data-error]').textContent='Aguarde a análise atual da Meta para editar novamente.';
      preview();dialog.showModal();
    }catch(error){notify(error.message);}finally{open.disabled=false;}
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();submit.disabled=true;$('[data-error]').textContent='';
    try{await api('/api/campaigns/carousel/template/edit',{method:'POST',body:JSON.stringify(values())});dialog.close();notify('Alterações enviadas para aprovação da Meta.');await refresh();}
    catch(error){$('[data-error]').textContent=error.message;submit.disabled=false;}
  });
}
