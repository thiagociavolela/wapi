import { describe, it, expect } from 'vitest';
import { createCarouselDefinition } from './carousel.js';
import { editCarouselDefinition } from './template-editor.js';

const original=createCarouselDefinition(Array.from({length:3},()=>({handle:'example-handle',name:'Produto',price:'R$ 10',description:'Descrição',url:'https://providafarma.com/produto/exemplo'})));
const edits={body:'Olá, {{1}}! Veja nossas ofertas.',cardBodies:Array(3).fill('Confira {{1}}, por {{2}}. Sobre o produto: {{3}}. Veja os detalhes e fale conosco.'),urlLabel:'Ver detalhes',replyLabel:'Tenho interesse'};
describe('edição do modelo compartilhado',()=>{
  it('preserva mídia, exemplos, links e estrutura sem modificar o original',()=>{
    const result=editCarouselDefinition(original.components,edits);
    expect(result[0]!.text).toBe(edits.body);
    const card=result[1]!.cards[0].components;
    expect(card[0]).toEqual(original.components[1]!.cards![0]!.components[0]);
    expect(card[2].buttons[0].url).toBe('https://providafarma.com/produto/{{1}}');
    expect(card[2].buttons[1].text).toBe('Tenho interesse');
    expect(original.components[0]!.text).not.toBe(edits.body);
  });
  it('impede remoção de variáveis e mudança no número de cartões',()=>{
    expect(()=>editCarouselDefinition(original.components,{...edits,body:'Sem variável'})).toThrow();
    expect(()=>editCarouselDefinition(original.components,{...edits,cardBodies:['{{1}} {{2}} {{3}}']})).toThrow();
    expect(()=>editCarouselDefinition(original.components,{...edits,cardBodies:Array(3).fill('{{1}} {{2}} {{4}}')})).toThrow();
  });
});
