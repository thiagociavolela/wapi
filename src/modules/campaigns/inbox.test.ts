import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ execute: vi.fn(), send: vi.fn(), record: vi.fn() }));
vi.mock('../../database/pool.js', () => ({ pool: { execute: mocks.execute } }));
vi.mock('../meta/client.js', () => ({ sendTemplate: mocks.send }));
vi.mock('../conversations/campaign-inbox.js', () => ({ recordCampaignSend: mocks.record }));
vi.mock('./carousel-media.js', () => ({ refreshCarouselImages: async (_org: string, components: unknown[]) => components }));
import { processCampaigns } from './service.js';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.send.mockResolvedValue({ messageId: 'wamid.campaign' });
  mocks.execute.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM campaigns WHERE')) return [[{ id: 'campaign', organizationId: 'org', templateName: 'offer', templateLanguage: 'pt_BR', templateComponents: [], templatePreview: 'Offer', delaySeconds: 5 }], []];
    if (sql.includes('SELECT id, phone, name')) return [[{ id: 'recipient', phone: '5511999999999', contactId: 'contact' }], []];
    if (sql.includes('SELECT id FROM conversations')) return [[{ id: 'conversation' }], []];
    if (sql.includes('SELECT profile_name')) return [[{ name: 'Customer' }], []];
    return [{ affectedRows: 1 }, []];
  });
});
it('creates campaign conversations outside New and records campaign origin on the message', async () => {
  await processCampaigns();
  const creation = mocks.execute.mock.calls.find(([sql]) => sql.includes('INSERT IGNORE INTO conversations'))!;
  expect(creation[0]).toContain("VALUES (?, ?, ?, 'campaign')");
  expect(creation[0]).not.toContain('first_response_due_at');
  const insert = mocks.execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO messages'))!;
  expect(JSON.parse(insert[1][4])).toMatchObject({ origin: 'campaign', campaignId: 'campaign' });
  expect(mocks.record).toHaveBeenCalledWith('org', 'conversation', insert[1][0], 'Offer');
});
it('does not reclassify an existing conversation when the campaign send fails', async () => {
  mocks.send.mockRejectedValueOnce(new Error('Meta unavailable'));
  await processCampaigns();
  expect(mocks.record).not.toHaveBeenCalled();
  expect(mocks.execute.mock.calls.some(([sql]) => sql.includes("UPDATE campaign_recipients SET status = 'failed'"))).toBe(true);
});
