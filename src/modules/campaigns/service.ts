import crypto from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "../../database/pool.js";
import { sendTemplate } from "../meta/client.js";

type Recipient = { phone: string; name?: string };
type CampaignInput = { name: string; description?: string; templateName: string; templateLanguage: string; templateComponents: unknown[]; templatePreview?: string; delaySeconds: number; scheduledFor?: Date; recipients: Recipient[]; saveContacts: boolean };

export function normalizeCampaignPhone(value: string, countryCode = "55") {
  const original = String(value ?? "").trim();
  const explicitInternational = original.startsWith("+") || original.startsWith("00");
  let phone = original.replace(/\D/g, "");
  if (phone.startsWith("00")) phone = phone.slice(2);
  if (!explicitInternational && countryCode === "55" && (phone.length === 10 || phone.length === 11)) phone = `55${phone}`;
  return /^\d{10,15}$/.test(phone) ? phone : null;
}

export function parseCampaignContacts(content: string, fileName: string) {
  const rows: Recipient[] = []; const invalid: string[] = [];
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const csv = fileName.toLowerCase().endsWith(".csv");
  lines.forEach((line, index) => {
    const columns = csv ? line.split(/[;,]/).map((value) => value.trim().replace(/^"|"$/g, "")) : [line];
    if (index === 0 && columns.some((value) => /^(nome|name|telefone|phone)$/i.test(value))) return;
    const phoneIndex = columns.findIndex((value) => normalizeCampaignPhone(value));
    const phone = phoneIndex >= 0 ? normalizeCampaignPhone(columns[phoneIndex]!) : null;
    if (!phone) { invalid.push(line); return; }
    const name = columns.find((value, columnIndex) => columnIndex !== phoneIndex && value) || undefined;
    rows.push({ phone, name });
  });
  const unique = [...new Map(rows.map((item) => [item.phone, item])).values()];
  return { items: unique, invalid, duplicates: rows.length - unique.length };
}

async function ensureContact(organizationId: string, recipient: Recipient) {
  await pool.execute(`INSERT INTO contacts (id, organization_id, wa_id, phone, name) VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE name = COALESCE(name, VALUES(name)), phone = VALUES(phone)`,
  [crypto.randomUUID(), organizationId, recipient.phone, recipient.phone, recipient.name ?? null]);
  const [rows] = await pool.execute<RowDataPacket[]>("SELECT id FROM contacts WHERE organization_id = ? AND wa_id = ? LIMIT 1", [organizationId, recipient.phone]);
  return String(rows[0]!.id);
}

export async function createCampaign(organizationId: string, userId: string, input: CampaignInput) {
  const recipients = [...new Map(input.recipients.map((item) => [normalizeCampaignPhone(item.phone), item])).entries()]
    .filter(([phone]) => phone).map(([phone, item]) => ({ phone: String(phone), name: item.name?.trim().slice(0, 160) || undefined }));
  if (!recipients.length) throw new Error("Adicione pelo menos um destinatário válido.");
  if (recipients.length > 5000) throw new Error("Cada campanha aceita até 5.000 destinatários.");
  const id = crypto.randomUUID(); const scheduledFor = input.scheduledFor ?? new Date();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(`INSERT INTO campaigns
      (id, organization_id, created_by_user_id, name, description, template_name, template_language, template_components, template_preview, delay_seconds, scheduled_for, next_send_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, organizationId, userId, input.name, input.description ?? null, input.templateName,
      input.templateLanguage, JSON.stringify(input.templateComponents), input.templatePreview ?? null, input.delaySeconds, scheduledFor, scheduledFor]);
    for (const recipient of recipients) {
      let contactId: string | null = null;
      if (input.saveContacts) {
        await connection.execute(`INSERT INTO contacts (id, organization_id, wa_id, phone, name) VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE name = COALESCE(name, VALUES(name)), phone = VALUES(phone)`,
        [crypto.randomUUID(), organizationId, recipient.phone, recipient.phone, recipient.name ?? null]);
        const [contacts] = await connection.execute<RowDataPacket[]>("SELECT id FROM contacts WHERE organization_id = ? AND wa_id = ? LIMIT 1", [organizationId, recipient.phone]);
        contactId = String(contacts[0]!.id);
      }
      await connection.execute(`INSERT INTO campaign_recipients (id, campaign_id, organization_id, contact_id, name, phone)
        VALUES (?, ?, ?, ?, ?, ?)`, [crypto.randomUUID(), id, organizationId, contactId, recipient.name ?? null, recipient.phone]);
    }
    await connection.execute(`INSERT INTO audit_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
      VALUES (?, ?, 'campaign.created', 'campaign', ?, ?)`, [organizationId, userId, id, JSON.stringify({ recipients: recipients.length, template: input.templateName })]);
    await connection.commit(); return { id, recipients: recipients.length };
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

export async function listCampaigns(organizationId: string) {
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT c.id, c.name, c.description, c.template_name AS templateName, c.template_language AS templateLanguage,
    c.delay_seconds AS delaySeconds, c.scheduled_for AS scheduledFor, c.status, c.created_at AS createdAt, u.name AS createdByName,
    COUNT(r.id) AS total, SUM(r.status = 'pending') AS pending, SUM(r.status = 'sent') AS sent,
    SUM(r.status = 'delivered') AS delivered, SUM(r.status = 'read') AS readCount, SUM(r.status = 'failed') AS failed,
    SUM(r.status = 'cancelled') AS cancelled
    FROM campaigns c JOIN users u ON u.id = c.created_by_user_id LEFT JOIN campaign_recipients r ON r.campaign_id = c.id
    WHERE c.organization_id = ? GROUP BY c.id ORDER BY c.created_at DESC LIMIT 100`, [organizationId]);
  return rows;
}

export async function getCampaign(organizationId: string, id: string) {
  const [campaigns] = await pool.execute<RowDataPacket[]>(`SELECT id, name, description, template_name AS templateName, template_language AS templateLanguage,
    template_preview AS templatePreview, delay_seconds AS delaySeconds, scheduled_for AS scheduledFor, status, created_at AS createdAt
    FROM campaigns WHERE id = ? AND organization_id = ? LIMIT 1`, [id, organizationId]);
  if (!campaigns[0]) return null;
  const [recipients] = await pool.execute<RowDataPacket[]>(`SELECT id, name, phone, status, error_message AS errorMessage, sent_at AS sentAt,
    delivered_at AS deliveredAt, read_at AS readAt FROM campaign_recipients WHERE campaign_id = ? ORDER BY created_at LIMIT 500`, [id]);
  return { ...campaigns[0], recipients };
}

export async function changeCampaignStatus(organizationId: string, id: string, action: "pause" | "resume" | "cancel") {
  if (action === "pause") {
    const [result] = await pool.execute<ResultSetHeader>("UPDATE campaigns SET status = 'paused' WHERE id = ? AND organization_id = ? AND status IN ('scheduled','running')", [id, organizationId]); return result.affectedRows > 0;
  }
  if (action === "resume") {
    const [result] = await pool.execute<ResultSetHeader>("UPDATE campaigns SET status = 'running', next_send_at = NOW(3), started_at = COALESCE(started_at, NOW(3)) WHERE id = ? AND organization_id = ? AND status = 'paused'", [id, organizationId]); return result.affectedRows > 0;
  }
  const [result] = await pool.execute<ResultSetHeader>("UPDATE campaigns SET status = 'cancelled', completed_at = NOW(3) WHERE id = ? AND organization_id = ? AND status IN ('scheduled','running','paused')", [id, organizationId]);
  if (result.affectedRows) await pool.execute("UPDATE campaign_recipients SET status = 'cancelled' WHERE campaign_id = ? AND status = 'pending'", [id]);
  return result.affectedRows > 0;
}

let processing = false; let timer: NodeJS.Timeout | undefined;
async function processCampaigns() {
  if (processing) return; processing = true;
  try {
    await pool.execute("UPDATE campaigns SET status = 'running', started_at = COALESCE(started_at, NOW(3)) WHERE status = 'scheduled' AND scheduled_for <= NOW(3)");
    const [campaigns] = await pool.execute<RowDataPacket[]>(`SELECT id, organization_id AS organizationId, template_name AS templateName,
      template_language AS templateLanguage, template_components AS templateComponents, template_preview AS templatePreview, delay_seconds AS delaySeconds
      FROM campaigns WHERE status = 'running' AND (next_send_at IS NULL OR next_send_at <= NOW(3)) ORDER BY next_send_at, created_at LIMIT 10`);
    for (const campaign of campaigns) {
      const [campaignClaim] = await pool.execute<ResultSetHeader>(`UPDATE campaigns
        SET next_send_at = DATE_ADD(NOW(3), INTERVAL ? SECOND)
        WHERE id = ? AND status = 'running' AND (next_send_at IS NULL OR next_send_at <= NOW(3))`, [Number(campaign.delaySeconds), campaign.id]);
      if (!campaignClaim.affectedRows) continue;
      const [rows] = await pool.execute<RowDataPacket[]>("SELECT id, phone, name, contact_id AS contactId, attempts FROM campaign_recipients WHERE campaign_id = ? AND status = 'pending' ORDER BY created_at LIMIT 1", [campaign.id]);
      const recipient = rows[0];
      if (!recipient) { await pool.execute("UPDATE campaigns SET status = 'completed', completed_at = NOW(3), next_send_at = NULL WHERE id = ? AND status = 'running'", [campaign.id]); continue; }
      const [claimed] = await pool.execute<ResultSetHeader>("UPDATE campaign_recipients SET status = 'processing', attempts = attempts + 1 WHERE id = ? AND status = 'pending'", [recipient.id]);
      if (!claimed.affectedRows) continue;
      let messageId: string | null = null;
      try {
        const organizationId = String(campaign.organizationId); const contactId = recipient.contactId ? String(recipient.contactId) : await ensureContact(organizationId, { phone: String(recipient.phone), name: recipient.name ?? undefined });
        await pool.execute("UPDATE campaign_recipients SET contact_id = ? WHERE id = ?", [contactId, recipient.id]);
        await pool.execute(`INSERT IGNORE INTO conversations (id, organization_id, contact_id, first_response_due_at, resolution_due_at)
          SELECT ?, ?, ?, DATE_ADD(NOW(3), INTERVAL COALESCE(s.first_response_minutes,15) MINUTE), DATE_ADD(NOW(3), INTERVAL COALESCE(s.resolution_minutes,480) MINUTE)
          FROM organizations o LEFT JOIN sla_policies s ON s.organization_id=o.id WHERE o.id=?`, [crypto.randomUUID(), organizationId, contactId, organizationId]);
        const [conversations] = await pool.execute<RowDataPacket[]>("SELECT id FROM conversations WHERE organization_id = ? AND contact_id = ? LIMIT 1", [organizationId, contactId]);
        const conversationId = String(conversations[0]!.id); messageId = crypto.randomUUID();
        const components = typeof campaign.templateComponents === "string" ? JSON.parse(campaign.templateComponents) : (campaign.templateComponents || []);
        await pool.execute(`INSERT INTO messages (id, organization_id, conversation_id, direction, type, text_body, content, status)
          VALUES (?, ?, ?, 'outbound', 'template', ?, ?, 'queued')`, [messageId, organizationId, conversationId, campaign.templatePreview ?? `Template: ${campaign.templateName}`, JSON.stringify({ template: campaign.templateName, language: campaign.templateLanguage, components, origin: "campaign", campaignId: campaign.id })]);
        const result = await sendTemplate(String(recipient.phone), String(campaign.templateName), String(campaign.templateLanguage), components);
        await pool.execute("UPDATE messages SET meta_message_id = ?, status = 'sent', sent_at = NOW(3) WHERE id = ?", [result.messageId, messageId]);
        await pool.execute("UPDATE campaign_recipients SET status = 'sent', message_id = ?, meta_message_id = ?, error_message = NULL, sent_at = NOW(3) WHERE id = ?", [messageId, result.messageId, recipient.id]);
        await pool.execute("UPDATE conversations SET last_message_preview = ?, last_message_at = NOW(3) WHERE id = ?", [String(campaign.templatePreview ?? `Template: ${campaign.templateName}`).slice(0, 500), conversationId]);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha no envio";
        await pool.execute("UPDATE campaign_recipients SET status = 'failed', message_id = ?, error_message = ? WHERE id = ?", [messageId, message, recipient.id]);
        if (messageId) await pool.execute("UPDATE messages SET status = 'failed', error_message = ? WHERE id = ?", [message, messageId]);
      }
    }
  } finally { processing = false; }
}

export function startCampaignWorker() { void processCampaigns(); timer = setInterval(() => void processCampaigns(), 1000); timer.unref(); }
