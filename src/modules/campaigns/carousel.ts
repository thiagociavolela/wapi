import type { TemplateDefinition } from '../integrations/service.js';

export const CAROUSEL_TEMPLATE_NAME = 'ofertas_produtos_carrossel';
export const CAROUSEL_CARD_TEXT = 'Conheça *{{1}}*, por *{{2}}*. Sobre o produto: {{3}}. Confira os detalhes e fale conosco.';
export interface CarouselCard { mediaId: string; parameters: string[]; url: string; productId?: string; title?: string }

export function createCarouselDefinition(examples: { handle: string; name: string; price: string; description: string; url: string }[]) {
  if (examples.length !== 3) throw new Error('O modelo inicial deve conter três cartões.');
  return {
    name: CAROUSEL_TEMPLATE_NAME, language: 'pt_BR', category: 'MARKETING',
    components: [
      { type: 'BODY', text: 'Olá, {{1}}! Selecionamos algumas opções para você. Confira os produtos abaixo e escolha entre mais detalhes ou solicitar contato.', example: { body_text: [['Maria']] } },
      { type: 'CAROUSEL', cards: examples.map(sample => ({ components: [
        { type: 'HEADER', format: 'IMAGE', example: { header_handle: [sample.handle] } },
        { type: 'BODY', text: CAROUSEL_CARD_TEXT, example: { body_text: [[sample.name, sample.price, sample.description]] } },
        { type: 'BUTTONS', buttons: [
          { type: 'URL', text: 'Quero mais detalhes', url: 'https://providafarma.com/produto/{{1}}', example: [sample.url] },
          { type: 'QUICK_REPLY', text: 'Quero Esse!' }
        ] }
      ] })) }
    ]
  };
}

function variables(text: string) {
  const names = [...new Set([...text.matchAll(/\{\{(\d+|[a-z_][a-z0-9_]*)\}\}/g)].map(match => match[1]!))];
  return names.every(name => /^\d+$/.test(name)) ? Array.from({ length: Math.max(0,...names.map(Number)) },(_,index)=>String(index+1)) : names;
}

export function buildCarouselComponents(template: TemplateDefinition, cards: CarouselCard[]) {
  const layout = template.components.find(component => component.type === 'CAROUSEL');
  if (!layout || !Array.isArray(layout.cards)) {
    if (cards.length) throw new Error('Este template não possui carrossel.');
    return [];
  }
  if (cards.length < 2 || cards.length > 10 || cards.length !== layout.cards.length) throw new Error(`Selecione os ${layout.cards.length} cartões previstos no modelo aprovado.`);
  return [{ type: 'carousel', cards: cards.map((card,index) => {
    const definition = layout.cards[index].components as Record<string,any>[];
    if (!definition.some(component => component.type==='HEADER'&&component.format==='IMAGE')) throw new Error('Este editor aceita carrosséis com imagens.');
    if (!/^\d+$/.test(card.mediaId)) throw new Error(`Envie uma imagem para o cartão ${index+1}.`);
    const components: Record<string,unknown>[] = [{ type: 'header', parameters: [{type:'image',image:{id:card.mediaId}}] }];
    const body = definition.find(component=>component.type==='BODY');
    if (body) {
      const names=variables(body.text||'');
      if(card.parameters.length!==names.length)throw new Error(`Preencha todas as variáveis do cartão ${index+1}.`);
      const rendered=String(body.text).replace(/\{\{(\d+|[a-z_][a-z0-9_]*)\}\}/g,(_,name)=>card.parameters[names.indexOf(name)]||'');
      if(rendered.length>160)throw new Error(`A descrição do cartão ${index+1} deve ter até 160 caracteres após preencher as variáveis.`);
      if(names.length)components.push({type:'body',parameters:card.parameters.map((text,parameterIndex)=>({type:'text',text,...(/^\d+$/.test(names[parameterIndex]!)?{}:{parameter_name:names[parameterIndex]})}))});
    }
    const buttons=definition.find(component=>component.type==='BUTTONS')?.buttons||[];
    for (let buttonIndex=0;buttonIndex<buttons.length;buttonIndex++) {
      const button=buttons[buttonIndex];
      if(button.type==='URL') {
        const placeholder=String(button.url).indexOf('{{1}}');
        if(placeholder>=0){
          const base=String(button.url).slice(0,placeholder),tail=String(button.url).slice(placeholder+5);
          const url=new URL(card.url); if(!['https:','http:'].includes(url.protocol)||!card.url.startsWith(base)||!card.url.endsWith(tail))throw new Error(`O link do cartão ${index+1} deve seguir ${button.url}.`);
          const suffix=card.url.slice(base.length,tail ? -tail.length : undefined);
          if(!suffix||suffix.includes('{{'))throw new Error(`Informe o link completo do cartão ${index+1}.`);
          components.push({type:'button',sub_type:'url',index:String(buttonIndex),parameters:[{type:'text',text:suffix}]});
        } else if(card.url&&card.url!==button.url)throw new Error(`O link do cartão ${index+1} é fixo no template.`);
      } else if(button.type==='QUICK_REPLY') {
        const payload=JSON.stringify({type:'carousel_contact',card:index,productId:card.productId||'',title:(card.title||card.parameters[0]||`Cartão ${index+1}`).slice(0,45)});
        if(Buffer.byteLength(payload)>256)throw new Error('O identificador do produto é muito longo.');
        components.push({type:'button',sub_type:'quick_reply',index:String(buttonIndex),parameters:[{type:'payload',payload}]});
      } else throw new Error('Este editor aceita botões de link e resposta rápida.');
    }
    return {card_index:index,components};
  }) }];
}

export function carouselContactText(payload: unknown) {
  if(typeof payload!=='string'||payload.length>1024)return null;
  try{const data=JSON.parse(payload);if(data.type!=='carousel_contact'||!Number.isInteger(data.card)||data.card<0||data.card>9)return null;
    const title=typeof data.title==='string'?data.title.slice(0,80):`Cartão ${data.card+1}`;
    const id=typeof data.productId==='string'?data.productId.slice(0,64):'';
    return `Quero Esse!: ${title}${id?` (produto ${id})`:''}`;
  }catch{return null;}
}
