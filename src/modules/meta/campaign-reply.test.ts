import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ execute: vi.fn(), tx: vi.fn(), commit: vi.fn(), rollback: vi.fn(), publish: vi.fn() }));
vi.mock('../../config.js', () => ({ config: { META_PHONE_NUMBER_ID: 'phone' } }));
vi.mock('../../database/pool.js', () => ({ pool: {
  execute: mocks.execute,
  getConnection: async () => ({ execute: mocks.tx, beginTransaction: vi.fn(), commit: mocks.commit, rollback: mocks.rollback, release: vi.fn() })
} }));
vi.mock('../conversations/service.js', () => ({ defaultOrganizationId: async () => 'org' }));
vi.mock('../realtime/events.js', () => ({ publish: mocks.publish }));
import { processWebhook } from './webhook.js';
const message = { id: 'wamid.reply', from: '5511999999999', timestamp: '1792490400', type: 'text', text: { body: 'Tenho interesse' } };
function payload(messages: unknown[], statuses: unknown[] = []) {
  return { field: 'messages', value: { metadata: { phone_number_id: 'phone' }, messages, statuses } };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockResolvedValue([{ affectedRows: 1 }, []]);
  mocks.tx.mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT id FROM contacts')) return [[{ id: 'contact' }], []];
    if (sql.includes('SELECT id FROM conversations')) return [[{ id: 'conversation' }], []];
    if (sql.includes('SELECT id FROM messages')) return [[{ id: 'target' }], []];
    return [{ affectedRows: 1 }, []];
  });
});
it('routes a real campaign reply to New and increments unread without changing open/pending status', async () => {
  await processWebhook(payload([message]));
  const update = mocks.tx.mock.calls.find(([sql]) => sql.includes('UPDATE conversations'))!;
  expect(update[0]).toContain("IF(c.status IN ('resolved', 'campaign'), 'new', c.status)");
  expect(update[0]).toContain('c.unread_count = c.unread_count + 1');
  expect(update[0]).toContain("IF(c.status = 'campaign', DATE_ADD");
  expect(update[0].indexOf('SET c.first_response_due_at')).toBeLessThan(update[0].indexOf('c.status = IF'));
  expect(update[1]).toEqual(['Tenho interesse', 1792490400, 'conversation']);
  expect(mocks.commit).toHaveBeenCalled();
  expect(mocks.publish).toHaveBeenCalledWith('org', { type: 'message', direction: 'inbound', conversationId: 'conversation' });
});
it('does not treat emoji reactions as a new customer conversation', async () => {
  await processWebhook(payload([{ ...message, type: 'reaction', reaction: { message_id: 'wamid.campaign', emoji: '👍' } }]));
  expect(mocks.tx.mock.calls.some(([sql]) => sql.includes('UPDATE conversations'))).toBe(false);
  expect(mocks.publish).toHaveBeenCalledWith('org', { type: 'reaction', conversationId: 'conversation' });
});
it('does not move campaign conversations on delivery/read receipts', async () => {
  await processWebhook(payload([], [{ id: 'wamid.campaign', status: 'read', timestamp: '1792490400' }]));
  expect(mocks.tx.mock.calls.some(([sql]) => sql.includes('UPDATE conversations'))).toBe(false);
});
it('does not process the same reply twice', async () => {
  const original = mocks.tx.getMockImplementation()!;
  mocks.tx.mockImplementation((sql: string, ...args: unknown[]) => sql.includes('INSERT IGNORE INTO webhook_events') ? Promise.resolve([{ affectedRows: 0 }, []]) : original(sql, ...args));
  await processWebhook(payload([message]));
  expect(mocks.tx.mock.calls.some(([sql]) => sql.includes('UPDATE conversations'))).toBe(false);
  expect(mocks.rollback).toHaveBeenCalled();
});
