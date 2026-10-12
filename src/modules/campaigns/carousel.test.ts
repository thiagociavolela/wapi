import {describe,it,expect} from 'vitest';
import {buildCarouselComponents,createCarouselDefinition,carouselContactText} from './carousel.js';
import {personalizeCampaignTemplate} from './service.js';
const examples=Array.from({length:3},()=>({handle:'example',name:'Produto',price:'R$ 25,00',description:'Confira',url:'https://providafarma.com/produto/example'}));
const template={...createCarouselDefinition(examples),status:'APPROVED'};
const cards=Array.from({length:3},(_,index)=>({mediaId:String(100+index),parameters:['Produto','R$ 25,00','Confira'],url:'https://providafarma.com/produto/example',productId:String(index+1)}));
describe('carousel campaigns',()=>{
  it('builds indexed images, scoped URL parameters and identifiable quick replies',()=>{
    const [carousel]=buildCarouselComponents(template,cards);
    expect(carousel!.cards[1]!.card_index).toBe(1);
    expect(carousel!.cards[0]!.components[0]).toEqual({type:'header',parameters:[{type:'image',image:{id:'100'}}]});
    expect(carousel!.cards[0]!.components[2]).toMatchObject({type:'button',sub_type:'url',index:'0',parameters:[{type:'text',text:'example'}]});
    const button=carousel!.cards[1]!.components[3] as any;
    expect(carouselContactText(button.parameters[0].payload)).toBe('Quero Esse!: Produto (produto 2)');
  });
  it('rejects missing cards and descriptions exceeding the WhatsApp limit',()=>{
    expect(()=>buildCarouselComponents(template,cards.slice(0,2))).toThrow('3 cartões');
    expect(()=>buildCarouselComponents(template,[{...cards[0]!,parameters:['x'.repeat(160),'R$ 25,00','Confira']},...cards.slice(1)])).toThrow('160 caracteres');
  });
  it('rejects a foreign URL and an image that has not been uploaded',()=>{
    expect(()=>buildCarouselComponents(template,[{...cards[0]!,url:'https://evil.example/produto/example'},...cards.slice(1)])).toThrow('link');
    expect(()=>buildCarouselComponents(template,[{...cards[0]!,mediaId:''},...cards.slice(1)])).toThrow('imagem');
  });
  it('leaves normal templates working and recognizes only valid contact payloads',()=>{
    expect(buildCarouselComponents({...template,components:[]},[])).toEqual([]);
    expect(carouselContactText('hello')).toBeNull();expect(carouselContactText('{"type":"carousel_contact","card":99}')).toBeNull();
  });
  it('personalizes the positional name without modifying card content',()=>{
    const components=[{type:'body',parameters:[{type:'text',text:'{{nome}}'}]},...buildCarouselComponents(template,cards)];
    const personalized=personalizeCampaignTemplate(components,'Olá {{nome}}','Maria');
    expect(personalized.components[0]).toMatchObject({parameters:[{text:'Maria'}]});
    expect(personalized.components[1]).toEqual(components[1]);expect(personalized.text).toBe('Olá Maria');
  });
});
