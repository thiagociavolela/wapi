import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../database/pool.js', () => ({ pool: { execute: vi.fn() } }));
vi.mock('../realtime/events.js', () => ({ publish: vi.fn() }));
import { pool } from '../../database/pool.js';
import { publish } from '../realtime/events.js';
import { recordCampaignSend } from './campaign-inbox.js';
const execute = vi.mocked(pool.execute);
beforeEach(() => {
  vi.clearAllMocks();
  execute.mockResolvedValue([{ affectedRows: 1 }, []] as any);
});
it('does not move assigned conversations, pending customer replies or active service to Campaigns', async () => {
  await recordCampaignSend('org', 'conversation', 'message', 'Offer');
  const [sql, args] = execute.mock.calls[0]!;
  expect(sql).toContain("c.status = 'campaign'");
  expect(sql).toContain('c.assigned_user_id IS NULL AND c.unread_count = 0');
  expect(sql).toContain("c.status = 'resolved' OR (c.status = 'new'");
  expect(sql).toContain("history.direction = 'inbound'");
  expect(sql).toContain("<> 'campaign'");
  expect(sql).toContain('c.first_response_due_at = NULL');
  expect(args).toEqual(['org', 'conversation']);
});
it('preserves newer customer previews and notifies the organization after sending', async () => {
  await recordCampaignSend('org', 'conversation', 'message', 'x'.repeat(600));
  const [sql, args] = execute.mock.calls[1]!;
  expect(sql).toContain('c.last_message_at <= m.created_at');
  expect(args).toEqual(['message', 'x'.repeat(500), 'org', 'conversation']);
  expect(publish).toHaveBeenCalledWith('org', { type: 'conversation', conversationId: 'conversation' });
});
