import crypto from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { pool } from "../../database/pool.js";
import { publish } from "../realtime/events.js";
import { defaultOrganizationId } from "../conversations/service.js";

type Json = Record<string, any>;

export async function processWebhook(payload: Json) {
  const organizationId = await defaultOrganizationId();
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const profileByWaId = new Map<string, string | undefined>(
        (value.contacts ?? []).map((contact: Json) => [String(contact.wa_id), contact.profile?.name])
      );
      for (const message of value.messages ?? []) {
        await processInbound(organizationId, message, profileByWaId.get(message.from));
      }
      for (const status of value.statuses ?? []) await processStatus(organizationId, status);
    }
  }
}

async function processInbound(organizationId: string, message: Json, profileName?: string) {
  if (!message.id || !message.from) return;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (!(await recordEvent(connection, `message:${message.id}`, message))) {
      await connection.rollback();
      return;
    }
    const [contacts] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM contacts WHERE organization_id = ? AND wa_id = ? LIMIT 1", [organizationId, message.from]);
    const contactId = contacts[0]?.id ? String(contacts[0].id) : crypto.randomUUID();
    if (!contacts[0]) {
      await connection.execute(`INSERT INTO contacts
        (id, organization_id, wa_id, phone, name, profile_name) VALUES (?, ?, ?, ?, ?, ?)`,
        [contactId, organizationId, message.from, message.from, profileName ?? null, profileName ?? null]);
    } else if (profileName) {
      await connection.execute("UPDATE contacts SET profile_name = COALESCE(name, ?) WHERE id = ?", [profileName, contactId]);
    }
    const [conversations] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM conversations WHERE organization_id = ? AND contact_id = ? LIMIT 1", [organizationId, contactId]);
    const conversationId = conversations[0]?.id ? String(conversations[0].id) : crypto.randomUUID();
    if (!conversations[0]) {
      await connection.execute("INSERT INTO conversations (id, organization_id, contact_id) VALUES (?, ?, ?)", [conversationId, organizationId, contactId]);
    }
    const text = extractText(message);
    await connection.execute(`INSERT IGNORE INTO messages
      (id, organization_id, conversation_id, meta_message_id, direction, type, text_body, content, status, created_at)
      VALUES (?, ?, ?, ?, 'inbound', ?, ?, ?, 'received', FROM_UNIXTIME(?))`,
      [crypto.randomUUID(), organizationId, conversationId, message.id, message.type ?? "unknown", text, JSON.stringify(message), Number(message.timestamp) || Math.floor(Date.now() / 1000)]);
    await connection.execute(`UPDATE conversations SET status = IF(status = 'resolved', 'new', status),
      unread_count = unread_count + 1, service_window_expires_at = DATE_ADD(NOW(3), INTERVAL 24 HOUR),
      last_message_preview = ?, last_message_at = FROM_UNIXTIME(?) WHERE id = ?`,
      [(text || `[${message.type ?? "mensagem"}]`).slice(0, 500), Number(message.timestamp) || Math.floor(Date.now() / 1000), conversationId]);
    await markEventProcessed(connection, `message:${message.id}`);
    await connection.commit();
    publish(organizationId, { type: "message", conversationId });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function processStatus(organizationId: string, status: Json) {
  if (!status.id || !status.status) return;
  const eventKey = `status:${status.id}:${status.status}:${status.timestamp ?? ""}`;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (!(await recordEvent(connection, eventKey, status))) { await connection.rollback(); return; }
    const statusName = ["sent", "delivered", "read", "failed"].includes(status.status) ? status.status : "sent";
    const dateColumn = statusName === "sent" ? "sent_at" : statusName === "delivered" ? "delivered_at" : statusName === "read" ? "read_at" : null;
    const error = status.errors?.[0];
    const dateAssignment = dateColumn ? `, ${dateColumn} = FROM_UNIXTIME(?)` : "";
    const params: any[] = [statusName, error?.code ? String(error.code) : null, error?.message ?? error?.title ?? null];
    if (dateColumn) params.push(Number(status.timestamp) || Math.floor(Date.now() / 1000));
    params.push(status.id, organizationId);
    await connection.execute(`UPDATE messages SET status = ?, error_code = ?, error_message = ?${dateAssignment}
      WHERE meta_message_id = ? AND organization_id = ?`, params);
    await markEventProcessed(connection, eventKey);
    await connection.commit();
    publish(organizationId, { type: "status", messageId: status.id });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

async function recordEvent(connection: PoolConnection, key: string, payload: Json) {
  const [result] = await connection.execute<any>(
    "INSERT IGNORE INTO webhook_events (id, deduplication_key, payload) VALUES (?, ?, ?)",
    [crypto.randomUUID(), key, JSON.stringify(payload)]);
  return result.affectedRows > 0;
}

async function markEventProcessed(connection: PoolConnection, key: string) {
  await connection.execute("UPDATE webhook_events SET status = 'processed', processed_at = NOW(3) WHERE deduplication_key = ?", [key]);
}

export function extractText(message: Json): string | null {
  if (message.type === "text") return message.text?.body ?? null;
  if (message.type === "button") return message.button?.text ?? null;
  if (message.type === "interactive") return message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? null;
  if (["image", "video", "document"].includes(message.type)) return message[message.type]?.caption ?? null;
  if (message.type === "location") return message.location?.name ?? message.location?.address ?? "Localização";
  return null;
}
