import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../database/pool.js', () => ({ pool: { execute: vi.fn() } }));
import { pool } from '../../database/pool.js';
import { listConversations } from './service.js';
const execute = vi.mocked(pool.execute);
beforeEach(() => execute.mockReset());
it('returns ten conversations and detects a next page without returning the extra row', async () => {
  const rows = Array.from({ length: 11 }, (_, id) => ({ id: String(id) }));
  execute.mockResolvedValueOnce([rows, []] as any);
  const page = await listConversations('org');
  expect(page.items).toEqual(rows.slice(0, 10));
  expect(page.hasMore).toBe(true);
  expect(execute.mock.calls[0][0]).toContain('c.id DESC LIMIT 11 OFFSET 0');
});
it('preserves organization, assignment and status filters on later pages', async () => {
  execute.mockResolvedValueOnce([[{ id: 'last' }], []] as any);
  const page = await listConversations('org', 'Maria', 'open', 'agent', 10, 20);
  expect(page).toEqual({ items: [{ id: 'last' }], hasMore: false });
  expect(execute.mock.calls[0][0]).toContain('LIMIT 11 OFFSET 20');
  expect(execute.mock.calls[0][1]).toEqual(['org', 'open', 'agent', '%Maria%', '%Maria%', '%Maria%']);
});
it('looks up a linked conversation within its organization', async () => {
  execute.mockResolvedValueOnce([[], []] as any);
  expect(await listConversations('org', '', undefined, undefined, 10, 0, 'linked')).toEqual({ items: [], hasMore: false });
  expect(execute.mock.calls[0][1]?.slice(0, 2)).toEqual(['org', 'linked']);
});
it('omits inactive filters so the all-conversations index can serve ordering', async () => {
  execute.mockResolvedValueOnce([[], []] as any);
  await listConversations('org');
  const [sql, params] = execute.mock.calls[0];
  expect(params).toEqual(['org']);
  expect(sql).toContain('WHERE c.organization_id = ?');
  expect(sql).not.toContain('IS NULL OR');
  expect(sql).not.toContain('LIKE');
});
it('hides administrator assignments for supervisors even with a forged attendant selection', async () => {
  execute.mockResolvedValueOnce([[], []] as any);
  await listConversations('org', '', 'open', 'admin-id', 10, 0, undefined, 'supervisor');
  const [sql, params] = execute.mock.calls[0];
  expect(sql).toContain("NOT EXISTS (SELECT 1 FROM users owner WHERE owner.id = c.assigned_user_id AND owner.role = 'admin')");
  expect(params).toEqual(['org', 'open', 'admin-id']);
});
it('applies supervisor visibility to counts and contact list previews', async () => {
  const { countConversations, listContacts } = await import('./service.js');
  execute.mockResolvedValueOnce([[{ total: 0 }], []] as any);
  await countConversations('org', '', 'supervisor-id', 'supervisor');
  expect(execute.mock.calls[0][0]).toContain("owner.role = 'admin'");
  execute.mockResolvedValueOnce([[], []] as any).mockResolvedValueOnce([[{ total: 0 }], []] as any);
  await listContacts('org', '', undefined, 1, 25, 'supervisor');
  for (const [sql] of execute.mock.calls.slice(1)) expect(sql).toContain("owner.role = 'admin'");
});
it('checks resource ownership within the authenticated organization', async () => {
  const { supervisorCanAccessResource } = await import('./service.js');
  for (const resource of ['conversation', 'message', 'scheduled'] as const) {
    execute.mockResolvedValueOnce([[], []] as any);
    expect(await supervisorCanAccessResource('org', 'secret', resource)).toBe(false);
    const [sql, params] = execute.mock.calls.at(-1)!;
    expect(sql).toContain("owner.role = 'admin'");
    expect(params).toEqual(['org', 'secret']);
  }
  execute.mockResolvedValueOnce([[{ id: 'visible' }], []] as any);
  expect(await supervisorCanAccessResource('org', 'visible', 'conversation')).toBe(true);
});
