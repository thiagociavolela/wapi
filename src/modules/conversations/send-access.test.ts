import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../database/pool.js', () => ({ pool: { execute: vi.fn() } }));
vi.mock('../realtime/events.js', () => ({ publish: vi.fn() }));
vi.mock('../meta/client.js', () => ({ sendText: vi.fn().mockResolvedValue({ messageId: 'meta-id' }) }));
import { pool } from '../../database/pool.js';
import { canSendConversation, sendAgentText } from './service.js';
beforeEach(() => vi.clearAllMocks());
it.each(['admin', 'supervisor'])('allows %s to reply without owning the conversation', async role => {
  vi.mocked(pool.execute).mockResolvedValueOnce([[{ assignedUserId: 'attendant', actorRole: role }], []] as any);
  expect(await canSendConversation('org', 'manager', 'conversation')).toBe(true);
  expect(pool.execute).toHaveBeenCalledWith(expect.stringContaining("actor.organization_id = c.organization_id"), ['manager', 'conversation', 'org']);
  expect(pool.execute).toHaveBeenCalledWith(expect.stringContaining("actor.role <> 'supervisor'"), expect.any(Array));
});
it('rejects missing or inaccessible conversations', async () => {
  vi.mocked(pool.execute).mockResolvedValueOnce([[], []] as any);
  expect(await canSendConversation('org', 'manager', 'conversation')).toBe(false);
});
it.each(['admin', 'supervisor'])('records the %s sender without changing the attendant', async role => {
  vi.mocked(pool.execute).mockResolvedValueOnce([[{ waId: '5511999999999', expiresAt: new Date(Date.now() + 60000) }], []] as any)
    .mockResolvedValue([{}, []] as any);
  await sendAgentText('org', role, 'conversation', 'Resposta', 'message-id');
  const calls = vi.mocked(pool.execute).mock.calls;
  expect(calls.find(([sql]) => String(sql).includes('INSERT INTO messages'))?.[1]).toEqual(['message-id', 'org', 'conversation', null, null, 'Resposta', role]);
  expect(calls.filter(([sql]) => String(sql).startsWith('UPDATE conversations'))).toHaveLength(1);
  expect(calls.every(([sql]) => !String(sql).includes('assigned_user_id'))).toBe(true);
});
