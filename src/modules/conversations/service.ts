import crypto from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "../../database/pool.js";
import { publish } from "../realtime/events.js";
import { sendText } from "../meta/client.js";

const DEFAULT_ORG_SQL = "SELECT id FROM organizations ORDER BY created_at LIMIT 1";

export async function defaultOrganizationId() {
  const [rows] = await pool.query<RowDataPacket[]>(DEFAULT_ORG_SQL);
  if (!rows[0]?.id) throw new Error("Nenhuma organização cadastrada.");
  return String(rows[0].id);
}

export async function listConversations(organizationId: string, search = "") {
  const term = `%${search.trim()}%`;
  const [rows] = await pool.execute<RowDataPacket[]>(`
    SELECT c.id, c.status, c.unread_count AS unreadCount,
      c.service_window_expires_at AS serviceWindowExpiresAt,
      c.last_message_preview AS lastMessagePreview, c.last_message_at AS lastMessageAt,
      ct.name, ct.profile_name AS profileName, ct.phone, ct.wa_id AS waId,
      u.name AS assignedUserName
    FROM conversations c
    JOIN contacts ct ON ct.id = c.contact_id
    LEFT JOIN users u ON u.id = c.assigned_user_id
    WHERE c.organization_id = ? AND (? = '%%' OR ct.name LIKE ? OR ct.profile_name LIKE ? OR ct.phone LIKE ?)
    ORDER BY c.last_message_at DESC, c.created_at DESC LIMIT 100`,
    [organizationId, term, term, term, term]
  );
  return rows;
}

export async function getMessages(organizationId: string, conversationId: string, before?: string) {
  const params: any[] = [organizationId, conversationId];
  let cursor = "";
  if (before) { cursor = "AND m.created_at < ?"; params.push(before); }
  const [rows] = await pool.execute<RowDataPacket[]>(`
    SELECT m.id, m.meta_message_id AS metaMessageId, m.direction, m.type,
      m.text_body AS textBody, m.content, m.status, m.error_message AS errorMessage,
      m.created_at AS createdAt, u.name AS senderName
    FROM messages m LEFT JOIN users u ON u.id = m.sent_by_user_id
    WHERE m.organization_id = ? AND m.conversation_id = ? ${cursor}
    ORDER BY m.created_at DESC, m.id DESC LIMIT 51`, params);
  const hasMore = rows.length > 50;
  return { items: rows.slice(0, 50).reverse(), hasMore };
}

export async function sendAgentText(organizationId: string, userId: string, conversationId: string, body: string) {
  const [rows] = await pool.execute<RowDataPacket[]>(`
    SELECT ct.wa_id AS waId, c.service_window_expires_at AS expiresAt
    FROM conversations c JOIN contacts ct ON ct.id = c.contact_id
    WHERE c.id = ? AND c.organization_id = ? LIMIT 1`, [conversationId, organizationId]);
  const conversation = rows[0];
  if (!conversation) throw new Error("Conversa não encontrada.");
  if (!conversation.expiresAt || new Date(conversation.expiresAt).getTime() <= Date.now()) {
    throw new Error("A janela de atendimento encerrou. Envie um template aprovado.");
  }
  const id = crypto.randomUUID();
  await pool.execute(`INSERT INTO messages
    (id, organization_id, conversation_id, direction, type, text_body, status, sent_by_user_id)
    VALUES (?, ?, ?, 'outbound', 'text', ?, 'queued', ?)`, [id, organizationId, conversationId, body, userId]);
  try {
    const result = await sendText(String(conversation.waId), body);
    await pool.execute("UPDATE messages SET meta_message_id = ?, status = 'sent', sent_at = NOW(3) WHERE id = ?", [result.messageId, id]);
    await pool.execute("UPDATE conversations SET last_message_preview = ?, last_message_at = NOW(3), status = 'open' WHERE id = ?", [body.slice(0, 500), conversationId]);
  } catch (error) {
    await pool.execute("UPDATE messages SET status = 'failed', error_message = ? WHERE id = ?", [error instanceof Error ? error.message : "Falha no envio", id]);
    throw error;
  } finally {
    publish(organizationId, { type: "message", conversationId });
  }
  return { id };
}

export async function markConversationRead(organizationId: string, conversationId: string) {
  const [result] = await pool.execute<ResultSetHeader>("UPDATE conversations SET unread_count = 0 WHERE id = ? AND organization_id = ?", [conversationId, organizationId]);
  return result.affectedRows > 0;
}

export async function assignConversation(organizationId: string, conversationId: string, userId: string | null) {
  const [result] = await pool.execute<ResultSetHeader>("UPDATE conversations SET assigned_user_id = ?, status = 'open' WHERE id = ? AND organization_id = ?", [userId, conversationId, organizationId]);
  if (result.affectedRows) publish(organizationId, { type: "conversation", conversationId });
  return result.affectedRows > 0;
}

export async function changeStatus(organizationId: string, conversationId: string, status: string) {
  const [result] = await pool.execute<ResultSetHeader>("UPDATE conversations SET status = ? WHERE id = ? AND organization_id = ?", [status, conversationId, organizationId]);
  if (result.affectedRows) publish(organizationId, { type: "conversation", conversationId });
  return result.affectedRows > 0;
}
