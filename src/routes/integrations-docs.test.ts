import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({ createIntegrationMessage: vi.fn(), getIntegrationMessage: vi.fn(), cancelIntegrationMessage: vi.fn() }));
vi.mock('../modules/integrations/service.js', () => service);
vi.mock('../config.js', () => ({ config: { INTEGRATION_API_KEY: 'documentation-test-key' } }));
import { integrationRouter } from './integrations.js';

const spec = JSON.parse(readFileSync(new URL('../../public/openapi/integrations.json', import.meta.url), 'utf8'));
let server: Server;
let base: string;
const headers = { Authorization: 'Bearer documentation-test-key', 'Content-Type': 'application/json', 'Idempotency-Key': 'test-event-123' };
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use('/api/integrations', integrationRouter);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
beforeEach(() => vi.resetAllMocks());

describe('contrato OpenAPI das integrações', () => {
  it('documenta todas as operações externas e sua autenticação', () => {
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.security).toEqual([{ IntegrationBearer: [] }]);
    expect(spec.components.securitySchemes.IntegrationBearer.scheme).toBe('bearer');
    expect(Object.keys(spec.paths)).toEqual(['/api/integrations/messages', '/api/integrations/messages/{id}']);
    for (const [path, item] of Object.entries<any>(spec.paths)) for (const method of ['post', 'get', 'delete']) if(item[method]) {
      expect(item[method].responses['401']).toBeDefined();
      expect(item[method].responses['503']).toBeDefined();
      expect(item[method].operationId).toBeTruthy();
    }
  });
  it('exige Bearer e idempotência conforme a documentação', async () => {
    const url = base + '/api/integrations/messages';
    expect((await fetch(url, { method: 'POST' })).status).toBe(401);
    expect((await fetch(url, { method: 'POST', headers: { ...headers, 'Idempotency-Key': 'short' }, body: '{}' })).status).toBe(400);
    expect(service.createIntegrationMessage).not.toHaveBeenCalled();
  });
  it('aceita os exemplos documentados sem acessar o banco nem enviar mensagens', async () => {
    const examples = spec.paths['/api/integrations/messages'].post.requestBody.content['application/json'].examples;
    for (const example of Object.values<any>(examples)) {
      service.createIntegrationMessage.mockResolvedValueOnce({ id: 'job-example', duplicate: false });
      // Mantém o teste válido depois que a data ilustrativa deixa de ser futura.
      const payload = { ...example.value, ...(example.value.sendAt ? { sendAt: new Date(Date.now()+86400000).toISOString() } : {}) };
      const response = await fetch(base+'/api/integrations/messages', { method: 'POST', headers, body: JSON.stringify(payload) });
      expect(response.status).toBe(202);
    }
    expect(service.createIntegrationMessage).toHaveBeenCalledTimes(3);
  });
  it('retorna os códigos documentados para duplicidade, ausência e cancelamento', async () => {
    service.createIntegrationMessage.mockResolvedValue({ id:'existing', duplicate:true });
    const body=JSON.stringify({ to:'5511999999999',template:'confirmacao_pedido' });
    expect((await fetch(base+'/api/integrations/messages',{method:'POST',headers,body})).status).toBe(200);
    service.getIntegrationMessage.mockResolvedValue(null);
    expect((await fetch(base+'/api/integrations/messages/missing',{headers})).status).toBe(404);
    service.cancelIntegrationMessage.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect((await fetch(base+'/api/integrations/messages/missing',{method:'DELETE',headers})).status).toBe(409);
    const cancelled=await fetch(base+'/api/integrations/messages/pending',{method:'DELETE',headers});
    expect(cancelled.status).toBe(204); expect(await cancelled.text()).toBe('');
  });
});
