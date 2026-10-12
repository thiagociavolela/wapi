import { describe, expect, it } from 'vitest';
import { templateContactName, normalizeTemplateNameComponents } from './template-parameters.js';
import { buildTemplateSnapshot } from '../integrations/service.js';

const fullName = 'Renata Fidelis do Carmo de Sant Ana Carvalho';
describe('nomes de contato em parâmetros de template', () => {
  it('encurta nomes em palavras inteiras até 30 caracteres', () => {
    expect(templateContactName(fullName)).toBe('Renata Fidelis do Carmo');
    expect(templateContactName('Ana Maria')).toBe('Ana Maria');
    expect(Array.from(templateContactName('Á'.repeat(40))).length).toBe(30);
  });
  it('ajusta o envio de pedido_confirmado e protege o retry antigo sem mudar tokens ou outros textos', () => {
    const description='Descrição de um produto com mais de trinta caracteres';
    const input=[{type:'body',parameters:[{type:'text',text:fullName},{type:'text',text:description}]},{type:'button',parameters:[{type:'text',text:'TOKEN_'.repeat(20)}]}];
    const result=normalizeTemplateNameComponents('pedido_confirmado',input) as any[];
    expect(result[0].parameters[0].text).toBe(templateContactName(fullName));
    expect(result[0].parameters[1].text).toBe(description);
    expect(result[1]).toEqual(input[1]);
    expect(input[0]!.parameters[0]!.text).toBe(fullName);
    expect(normalizeTemplateNameComponents('outro_modelo',input)).toEqual(input);
  });
  it('mantém prévia e parâmetros da integração iguais ao nome efetivamente enviado', () => {
    const snapshot=buildTemplateSnapshot({name:'pedido_confirmado',status:'APPROVED',language:'pt_BR',category:'UTILITY',components:[{type:'BODY',text:'Oi, {{1}}, seu pedido é {{2}}.'}]},[fullName,'123']);
    expect(snapshot.text).toBe('Oi, Renata Fidelis do Carmo, seu pedido é 123.');
    expect((snapshot.components[0] as any).parameters[0].text).toBe(templateContactName(fullName));
  });
});
