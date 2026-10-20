import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ list: vi.fn(), count: vi.fn(), access: vi.fn(), role: "admin" }));
vi.mock('../modules/conversations/service.js', async importOriginal => ({
  ...await importOriginal<typeof import('../modules/conversations/service.js')>(),
  listConversations: mocks.list,
  countConversations: mocks.count,
  supervisorCanAccessResource: mocks.access
}));
vi.mock('../modules/auth/auth.js', async importOriginal => ({
  ...await importOriginal<typeof import('../modules/auth/auth.js')>(),
  requireAuth: (req: any, _res: any, next: any) => {
    req.auth = { id: 'current-user', organizationId: 'current-org', role: mocks.role };
    next();
  }
}));
import { apiRouter } from './api.js';
let server: Server;
let base: string;
const agent = '11111111-1111-4111-8111-111111111111';
beforeAll(async () => {
  const app = express();
  app.use('/api', apiRouter);
  app.use((error: any, _req: any, res: any, _next: any) => res.status(400).json({ error: error.message }));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}/api/conversations`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = "admin";
  mocks.access.mockResolvedValue(false);
  mocks.list.mockResolvedValue({ items: [], hasMore: false });
  mocks.count.mockResolvedValue({ total: 20 });
});
it('filters open conversations by the selected attendant across pages and keeps the authenticated organization', async () => {
  const response = await fetch(`${base}?status=open&assignedUserId=${agent}&search=Maria&offset=10`);
  expect(response.status).toBe(200);
  expect(mocks.list).toHaveBeenCalledWith('current-org', 'Maria', 'open', agent, 10, 10, undefined, 'admin');
  expect(mocks.count).not.toHaveBeenCalled();
});
it('returns all attendants when no attendant is selected', async () => {
  expect((await fetch(`${base}?status=open`)).status).toBe(200);
  expect(mocks.list).toHaveBeenCalledWith('current-org', '', 'open', undefined, 10, 0, undefined, 'admin');
});
it('does not apply the attendant selection to other tabs and keeps Mine bound to the current user', async () => {
  await fetch(`${base}?status=resolved&assignedUserId=${agent}`);
  expect(mocks.list).toHaveBeenLastCalledWith('current-org', '', 'resolved', undefined, 10, 0, undefined, 'admin');
  await fetch(`${base}?mine=true&assignedUserId=${agent}`);
  expect(mocks.list).toHaveBeenLastCalledWith('current-org', '', undefined, 'current-user', 10, 0, undefined, 'admin');
});
it('rejects an invalid attendant identifier before querying', async () => {
  expect((await fetch(`${base}?status=open&assignedUserId=invalid`)).status).toBe(400);
  expect(mocks.list).not.toHaveBeenCalled();
});
it('accepts the Campaigns filter and preserves organization and supervisor visibility', async () => {
  mocks.role = 'supervisor';
  expect((await fetch(`${base}?status=campaign`)).status).toBe(200);
  expect(mocks.list).toHaveBeenCalledWith('current-org', '', 'campaign', undefined, 10, 0, undefined, 'supervisor');
});
it('paginates unread conversations with search and supervisor visibility', async () => {
  mocks.role = 'supervisor';
  expect((await fetch(`${base}?status=unread&search=Maria&offset=10`)).status).toBe(200);
  expect(mocks.list).toHaveBeenCalledWith('current-org', 'Maria', 'unread', undefined, 10, 10, undefined, 'supervisor');
  expect(mocks.count).not.toHaveBeenCalled();
});
it('selects all matching IDs in lightweight pages without recalculating counters', async () => {
  mocks.role = 'supervisor';
  const cursor = '22222222-2222-4222-8222-222222222222';
  expect((await fetch(`${base}?status=open&assignedUserId=${agent}&selection=true&limit=1000&after=${cursor}`)).status).toBe(200);
  expect(mocks.list).toHaveBeenCalledWith('current-org', '', 'open', agent, 1000, 0, undefined, 'supervisor', true, cursor);
  expect(mocks.count).not.toHaveBeenCalled();
});
it('rejects the attendant filter for agents at the API', async () => {
  mocks.role = 'agent';
  expect((await fetch(`${base}?status=open&assignedUserId=${agent}`)).status).toBe(403);
  expect(mocks.list).not.toHaveBeenCalled();
});
it('passes supervisor visibility to both the list and counters', async () => {
  mocks.role = 'supervisor';
  expect((await fetch(`${base}?status=open&assignedUserId=${agent}`)).status).toBe(200);
  expect(mocks.list).toHaveBeenCalledWith('current-org', '', 'open', agent, 10, 0, undefined, 'supervisor');
  expect(mocks.count).toHaveBeenCalledWith('current-org', '', 'current-user', 'supervisor');
});
it('blocks direct supervisor access to restricted history, media and scheduled resources', async () => {
  mocks.role = 'supervisor';
  const root = base.replace('/conversations', '');
  for (const [path, resource] of [['conversations/secret/messages', 'conversation'], ['messages/secret/media', 'message'], ['scheduled/secret', 'scheduled']]) {
    expect((await fetch(`${root}/${path}`)).status).toBe(403);
    expect(mocks.access).toHaveBeenLastCalledWith('current-org', 'secret', resource);
  }
});
