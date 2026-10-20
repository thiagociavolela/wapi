import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../database/pool.js', () => ({ pool: { execute: vi.fn() } }));
vi.mock('../realtime/events.js', () => ({ publish: vi.fn() }));
import { pool } from '../../database/pool.js';
import { publish } from '../realtime/events.js';
import { markConversationRead } from './service.js';
beforeEach(() => vi.clearAllMocks());
it('refreshes the inbox when a conversation stops being unread', async () => {
  vi.mocked(pool.execute).mockResolvedValueOnce([{ affectedRows: 1 }, []] as any);
  expect(await markConversationRead('org', 'conversation')).toBe(true);
  expect(pool.execute).toHaveBeenCalledWith(expect.stringContaining('AND unread_count > 0'), ['conversation', 'org']);
  expect(publish).toHaveBeenCalledWith('org', { type: 'conversation', conversationId: 'conversation' });
});
it('avoids repeated refreshes for conversations already marked as read', async () => {
  vi.mocked(pool.execute).mockResolvedValueOnce([{ affectedRows: 0 }, []] as any);
  await markConversationRead('org', 'conversation');
  expect(publish).not.toHaveBeenCalled();
});
