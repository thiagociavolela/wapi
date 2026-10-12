import { api } from './api.js';
const escape=value=>{const node=document.createElement('span');node.textContent=String(value??'');return node.innerHTML;};
const $=selector=>document.querySelector(selector);
const variables=text=>[...new Set([...String(text||'').matchAll(/\{\{(\d+|[a-z_][a-z0-9_]*)\}\}/g)].map(match=>match[1]))];
const safeUrl=value=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:'';}catch{return '';}};

export function createCarouselEditor(notify,options={}) {
  const fields=options.fields||'#campaign-template-fields',submit=options.submit||'#save-campaign';
  const root=document.querySelector(fields);
  const $=selector=>selector===fields?root:selector===submit?document.querySelector(submit):root.querySelector(selector);
  const mediaBase=()=>typeof options.mediaBase==='function'?options.mediaBase():options.mediaBase||'/api/campaigns/carousel';
  let template=null,cards=[],uploading=0,revision=0,restoringFocus=false;
  const searches=new Map();
  const price=value=>{const text=String(value??'').replace(/[^\d,.-]/g,'');const amount=Number(text.includes(',')?text.replace(/\./g,'').replace(',','.'):text);return text&&Number.isFinite(amount)?new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(amount):'Preço não informado';};
  function clearSearches(){for(const state of searches.values()){clearTimeout(state.timer);state.controller?.abort();}searches.clear();}
  function searchState(index){if(!searches.has(index))searches.set(index,{term:'',items:[],sequence:0,focused:0,closed:true});return searches.get(index);}
  function renderSearch(index){
    const state=searchState(index),panel=$(`[data-carousel-search-results="${index}"]`),input=$(`[data-carousel-search="${index}"]`);if(!panel||!input)return;
    const visible=!!state.term&&!state.closed;panel.classList.toggle('hidden',!visible);input.setAttribute('aria-expanded',String(visible));
    input.removeAttribute('aria-activedescendant');
    if(!visible)return;
    if(state.loading){panel.innerHTML='<div class="carousel-search-message" role="status">Buscando produtos…</div>';return;}
    if(state.error){panel.innerHTML=`<div class="carousel-search-message" role="alert">${escape(state.error)}</div>`;return;}
    panel.innerHTML=state.items.length?state.items.map((product,position)=>`<button type="button" role="option" id="carousel-search-${index}-${position}" aria-selected="${position===state.focused}" data-carousel-result="${index}" data-product-id="${product.id}">${safeUrl(product.imageUrl)?`<img src="${escape(safeUrl(product.imageUrl))}" alt="" loading="lazy">`:'<span class="carousel-search-no-image">Sem foto</span>'}<span><strong>${escape(product.name)}</strong><small>ID ${product.id} · ${escape(price(product.price))}</small>${product.shortDescription?`<small class="carousel-search-description">${escape(product.shortDescription)}</small>`:''}</span></button>`).join(''):'<div class="carousel-search-message" role="status">Nenhum produto encontrado.</div>';
    if(state.items.length)input.setAttribute('aria-activedescendant',`carousel-search-${index}-${state.focused}`);
  }
  function scheduleSearch(index,query){
    const state=searchState(index);clearTimeout(state.timer);state.controller?.abort();state.sequence++;
    state.term=query.trim();state.closed=!state.term;state.items=[];state.error='';state.loading=!!state.term;state.focused=0;renderSearch(index);
    if(!state.term)return;
    const sequence=state.sequence,current=revision;
    state.timer=setTimeout(async()=>{
      const controller=new AbortController();state.controller=controller;
      try{const data=await api(`/api/products?active=true&search=${encodeURIComponent(state.term)}`,{signal:controller.signal});if(sequence!==state.sequence||current!==revision)return;state.items=data.items.filter(product=>product.active);}
      catch(error){if(sequence!==state.sequence||current!==revision||error.name==='AbortError')return;state.error='Não foi possível pesquisar. Digite novamente para tentar.';}
      finally{if(sequence===state.sequence&&current===revision){state.loading=false;renderSearch(index);}}
    },300);
  }
  function selectProduct(index,productId){
    const state=searchState(index);state.closed=true;renderSearch(index);
    void prepare(index,()=>api(`${mediaBase()}/product-media`,{method:'POST',body:JSON.stringify({productId})}));
  }
  function definitions(){return template?.components?.find(component=>component.type==='CAROUSEL')?.cards||[];}
  function body(index){return definitions()[index]?.components?.find(component=>component.type==='BODY')?.text||'';}
  function rendered(index){const names=variables(body(index));return body(index).replace(/\{\{(\d+|[a-z_][a-z0-9_]*)\}\}/g,(_,name)=>cards[index].parameters[names.indexOf(name)]||`{{${name}}}`);}
  function urlPattern(index){return definitions()[index]?.components?.find(component=>component.type==='BUTTONS')?.buttons?.find(button=>button.type==='URL')?.url||'';}
  function renderCards(){
    const host=$('#carousel-card-editor');if(!host)return;
    const focused=document.activeElement?.dataset?.carouselSearch;const position=focused!==undefined?document.activeElement.selectionStart:null;
    host.innerHTML=cards.map((card,index)=>{
      const names=variables(body(index));const pattern=urlPattern(index);
      return `<article class="carousel-edit-card" data-carousel-card="${index}"><header><strong>Cartão ${index+1}</strong><span data-carousel-length="${index}"></span></header><img data-carousel-image="${index}" class="${card.previewUrl?'':'hidden'}" src="${escape(card.previewUrl||'')}" alt="Imagem do cartão ${index+1}"><div class="carousel-product-search"><label>Buscar produto<input type="search" data-carousel-search="${index}" value="${escape(searchState(index).term)}" placeholder="Nome, ID ou descri&#231;&#227;o..." autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="carousel-search-results-${index}"></label><div id="carousel-search-results-${index}" data-carousel-search-results="${index}" class="carousel-search-results hidden" role="listbox" aria-label="Produtos encontrados"></div>${card.productId?`<small>Produto selecionado: ID ${escape(card.productId)}</small>`:''}</div><label>Imagem do cartão<input type="file" data-carousel-upload="${index}" accept="image/jpeg,image/png,image/webp"><small>Selecione uma imagem ou carregue um produto. A imagem será preparada para o WhatsApp.</small></label>${names.map((name,parameter)=>`<label>${template.name==='ofertas_produtos_carrossel'?['Nome do produto','Preço','Descrição curta'][parameter]||`Variável {{${name}}}`:`Variável {{${name}}}`}<input required maxlength="160" data-carousel-parameter="${parameter}" data-carousel-index="${index}" value="${escape(card.parameters[parameter]||'')}"></label>`).join('')}<label>Link de detalhes<input type="url" required data-carousel-field="url" data-carousel-index="${index}" value="${escape(card.url||'')}" placeholder="${escape(pattern)}"><small>Use o formato do template aprovado: ${escape(pattern)}</small></label><small data-carousel-upload-status="${index}">${card.mediaId?'Imagem preparada':'Imagem ainda não enviada'}</small></article>`;
    }).join('');cards.forEach((card,index)=>renderSearch(index));preview();
    if(focused!==undefined){const input=$(`[data-carousel-search="${focused}"]`);restoringFocus=true;input?.focus();restoringFocus=false;if(input&&position!==null)input.setSelectionRange(position,position);}
  }
  function preview(){
    const host=$('#carousel-live-preview');if(!host)return;
    host.innerHTML=`<h3>Prévia dos cartões</h3><p>Deslize para revisar. A aparência final é controlada pelo WhatsApp.</p><div class="carousel-preview-track">${cards.map((card,index)=>`<article>${card.previewUrl?`<img src="${escape(card.previewUrl)}" alt="Cartão ${index+1}">`:'<div class="carousel-image-empty">Escolha uma imagem</div>'}<p>${escape(rendered(index)).replace(/\*([^*]+)\*/g,'<strong>$1</strong>')}</p><a ${safeUrl(card.url)?`href="${escape(safeUrl(card.url))}" target="_blank" rel="noopener noreferrer"`:''}>${escape(definitions()[index].components.find(item=>item.type==='BUTTONS')?.buttons?.find(item=>item.type==='URL')?.text||'Quero mais detalhes')}</a><span>${escape(definitions()[index].components.find(item=>item.type==='BUTTONS')?.buttons?.find(item=>item.type==='QUICK_REPLY')?.text||'Quero Esse!')}</span></article>`).join('')}</div>`;
    cards.forEach((card,index)=>{const count=$(`[data-carousel-length="${index}"]`);if(count){const length=rendered(index).length;count.textContent=`${length}/160 caracteres`;count.classList.toggle('recipient-error',length>160);}});
  }
  function render(selected){
    revision++;clearSearches();template=selected;cards=[];
    if(!definitions().length)return;
    cards=definitions().map((definition,index)=>({mediaId:'',previewUrl:'',productId:'',parameters:variables(body(index)).map(()=>''),url:urlPattern(index).includes('{{')?'':urlPattern(index)}));
    $(fields).insertAdjacentHTML('beforeend','<div class="carousel-composer"><p>Preencha todos os cartões definidos no modelo aprovado. Use <strong>{{nome}}</strong> no texto principal para personalizar o nome de cada destinatário.</p><div id="carousel-card-editor"></div><div id="carousel-live-preview"></div></div>');renderCards();
  }
  async function prepare(index,request){
    const card=cards[index];if(!card)return;const current=revision;
    const version=card.requestVersion=(card.requestVersion||0)+1;
    uploading++;$(submit).disabled=true;
    const status=$(`[data-carousel-upload-status="${index}"]`);if(status)status.textContent='Preparando imagem…';
    try {
      const data=await request();if(current!==revision||version!==card.requestVersion)return;
      card.mediaId=data.mediaId;card.previewUrl=data.previewUrl;
      if(data.product){const product=data.product;card.productId=String(product.id);card.productName=product.name;card.url=product.productUrl||'';searchState(index).term=product.name;searchState(index).closed=true;
        if(template.name==='ofertas_produtos_carrossel')card.parameters=[product.name.slice(0,35),price(product.price),(product.shortDescription||'Confira mais detalhes na loja').replace(/\s+/g,' ').slice(0,25)];
      }
      renderCards();
    } catch(error){if(current===revision&&version===card.requestVersion){if(status)status.textContent='Não foi possível preparar a imagem.';notify(error.message);}}
    finally{uploading--;$(submit).disabled=uploading>0;}
  }
  $(fields).addEventListener('click',event=>{const button=event.target.closest('[data-carousel-result]');if(button)selectProduct(Number(button.dataset.carouselResult),Number(button.dataset.productId));});
  $(fields).addEventListener('change',event=>{if(event.target.dataset.carouselUpload===undefined)return;const file=event.target.files[0];if(!file)return;const form=new FormData();form.append('file',file);void prepare(Number(event.target.dataset.carouselUpload),()=>api(`${mediaBase()}/media`,{method:'POST',body:form}));});
  $(fields).addEventListener('input',event=>{if(event.target.dataset.carouselSearch!==undefined){scheduleSearch(Number(event.target.dataset.carouselSearch),event.target.value);return;}const index=Number(event.target.dataset.carouselIndex);const card=cards[index];if(!card)return;
    if(event.target.dataset.carouselParameter!==undefined)card.parameters[Number(event.target.dataset.carouselParameter)]=event.target.value;
    else if(event.target.dataset.carouselField)card[event.target.dataset.carouselField]=event.target.value;
    preview();
  });
  $(fields).addEventListener('keydown',event=>{
    if(event.target.dataset.carouselSearch===undefined)return;const index=Number(event.target.dataset.carouselSearch),state=searchState(index);
    if(event.key==='Escape'){event.preventDefault();state.closed=true;renderSearch(index);}
    else if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();if(!state.items.length)return;state.closed=false;state.focused=(state.focused+(event.key==='ArrowDown'?1:-1)+state.items.length)%state.items.length;renderSearch(index);$(`#carousel-search-${index}-${state.focused}`)?.scrollIntoView({block:'nearest'});}
    else if(event.key==='Enter'){event.preventDefault();if(!state.closed&&state.items[state.focused])selectProduct(index,state.items[state.focused].id);}
  });
  $(fields).addEventListener('focusin',event=>{if(restoringFocus||event.target.dataset.carouselSearch===undefined)return;const index=Number(event.target.dataset.carouselSearch),state=searchState(index);if(state.items.length){state.closed=false;renderSearch(index);}});
  document.addEventListener('click',event=>{if(event.target.closest('.carousel-product-search'))return;for(const [index,state] of searches){state.closed=true;renderSearch(index);}});
  function serialize(){
    if(uploading)throw new Error('Aguarde a preparação das imagens.');
    if(cards.some(card=>!card.mediaId))throw new Error('Envie uma imagem para cada cartão do carrossel.');
    return cards.map(card=>({mediaId:card.mediaId,parameters:card.parameters.map(value=>value.trim()),url:card.url,productId:card.productId,title:card.parameters[0]?.slice(0,80)||''}));
  }
  function restore(components){
    const carousel=components.find(component=>component.type==='carousel');if(!carousel)return;
    cards=carousel.cards.map((item,index)=>{
      const mediaId=item.components.find(component=>component.type==='header')?.parameters?.[0]?.image?.id||'';
      const parameters=item.components.find(component=>component.type==='body')?.parameters?.map(parameter=>parameter.text)||[];
      const suffix=item.components.find(component=>component.type==='button'&&component.sub_type==='url')?.parameters?.[0]?.text;
      const payload=item.components.find(component=>component.type==='button'&&component.sub_type==='quick_reply')?.parameters?.[0]?.payload;
      let productId='';try{productId=JSON.parse(payload||'{}').productId||'';}catch{}
      return {mediaId,previewUrl:mediaId?`/api/campaigns/carousel/media/${mediaId}`:'',parameters,productId,url:suffix?urlPattern(index).replace('{{1}}',suffix):urlPattern(index)};
    });renderCards();
  }
  return {render,serialize,restore,preview};
}
