import crypto from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "../../database/pool.js";
import { publish } from "../realtime/events.js";
import { downloadMedia, sendMedia, sendTemplate, sendText, uploadMedia } from "../meta/client.js";

const DEFAULT_ORG_SQL = "SELECT id FROM organizations ORDER BY created_at LIMIT 1";

export async function defaultOrganizationId() {
  const [rows] = await pool.query<RowDataPacket[]>(DEFAULT_ORG_SQL);
  if (!rows[0]?.id) throw new Error("Nenhuma organização cadastrada.");
  return String(rows[0].id);
}

export async function listConversations(organizationId: string, search = "", status?: "new" | "open" | "pending" | "resolved") {
  const term = `%${search.trim()}%`;
  const [rows] = await pool.execute<RowDataPacket[]>(`
    SELECT c.id, c.status, c.priority, c.unread_count AS unreadCount,
      c.service_window_expires_at AS serviceWindowExpiresAt,
      c.first_response_due_at AS firstResponseDueAt, c.first_response_at AS firstResponseAt, c.resolution_due_at AS resolutionDueAt,
      c.last_message_preview AS lastMessagePreview, c.last_message_at AS lastMessageAt,
      ct.id AS contactId, ct.name, ct.profile_name AS profileName, ct.phone, ct.wa_id AS waId,
      u.name AS assignedUserName, t.id AS teamId, t.name AS teamName, t.color AS teamColor,
      (SELECT GROUP_CONCAT(t.name ORDER BY t.name SEPARATOR '||') FROM conversation_tags ctag JOIN tags t ON t.id = ctag.tag_id WHERE ctag.conversation_id = c.id) AS tagNames
    FROM conversations c
    JOIN contacts ct ON ct.id = c.contact_id
    LEFT JOIN users u ON u.id = c.assigned_user_id
    LEFT JOIN teams t ON t.id = c.team_id
    WHERE c.organization_id = ? AND (? = '' OR c.status = ?) AND (? = '%%' OR ct.name LIKE ? OR ct.profile_name LIKE ? OR ct.phone LIKE ?)
    ORDER BY c.last_message_at DESC, c.created_at DESC LIMIT 100`,
    [organizationId, status || "", status || "", term, term, term, term]
  );
  return rows;
}

export async function countConversations(organizationId: string, search = "") {
  const term = `%${search.trim()}%`;
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total,
    SUM(c.status = 'new') AS newCount, SUM(c.status = 'open') AS openCount,
    SUM(c.status = 'pending') AS pendingCount, SUM(c.status = 'resolved') AS resolvedCount,
    COALESCE(SUM(c.unread_count), 0) AS unreadCount
    FROM conversations c JOIN contacts ct ON ct.id = c.contact_id
    WHERE c.organization_id = ? AND (? = '%%' OR ct.name LIKE ? OR ct.profile_name LIKE ? OR ct.phone LIKE ?)`,
    [organizationId, term, term, term, term]);
  return rows[0] || {};
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

export async function sendAgentText(organizationId: string, userId: string, conversationId: string, body: string, clientId?: string) {
  const [rows] = await pool.execute<RowDataPacket[]>(`
    SELECT ct.wa_id AS waId, c.service_window_expires_at AS expiresAt
    FROM conversations c JOIN contacts ct ON ct.id = c.contact_id
    WHERE c.id = ? AND c.organization_id = ? LIMIT 1`, [conversationId, organizationId]);
  const conversation = rows[0];
  if (!conversation) throw new Error("Conversa não encontrada.");
  if (!conversation.expiresAt || new Date(conversation.expiresAt).getTime() <= Date.now()) {
    throw new Error("A janela de atendimento encerrou. Envie um template aprovado.");
  }
  const id = clientId || crypto.randomUUID();
  await pool.execute(`INSERT INTO messages
    (id, organization_id, conversation_id, direction, type, text_body, status, sent_by_user_id)
    VALUES (?, ?, ?, 'outbound', 'text', ?, 'queued', ?)`, [id, organizationId, conversationId, body, userId]);
  try {
    const result = await sendText(String(conversation.waId), body);
    await pool.execute("UPDATE messages SET meta_message_id = ?, status = 'sent', sent_at = NOW(3) WHERE id = ?", [result.messageId, id]);
    await pool.execute("UPDATE conversations SET last_message_preview = ?, last_message_at = NOW(3), status = 'open', first_response_at = COALESCE(first_response_at, NOW(3)) WHERE id = ?", [body.slice(0, 500), conversationId]);
  } catch (error) {
    await pool.execute("UPDATE messages SET status = 'failed', error_message = ? WHERE id = ?", [error instanceof Error ? error.message : "Falha no envio", id]);
    throw error;
  } finally {
    publish(organizationId, { type: "message", conversationId });
  }
  return { id };
}

export async function sendAgentTemplate(organizationId: string, userId: string, conversationId: string, name: string, language: string, components: unknown[]) {
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT ct.wa_id AS waId
    FROM conversations c JOIN contacts ct ON ct.id = c.contact_id
    WHERE c.id = ? AND c.organization_id = ? LIMIT 1`, [conversationId, organizationId]);
  const conversation = rows[0];
  if (!conversation) throw new Error("Conversa não encontrada.");
  const id = crypto.randomUUID();
  const preview = `Template: ${name}`;
  await pool.execute(`INSERT INTO messages
    (id, organization_id, conversation_id, direction, type, text_body, content, status, sent_by_user_id)
    VALUES (?, ?, ?, 'outbound', 'template', ?, ?, 'queued', ?)`,
    [id, organizationId, conversationId, preview, JSON.stringify({ name, language, components }), userId]);
  try {
    const result = await sendTemplate(String(conversation.waId), name, language, components);
    await pool.execute("UPDATE messages SET meta_message_id = ?, status = 'sent', sent_at = NOW(3) WHERE id = ?", [result.messageId, id]);
    await pool.execute("UPDATE conversations SET last_message_preview = ?, last_message_at = NOW(3), status = 'open', first_response_at = COALESCE(first_response_at, NOW(3)) WHERE id = ?", [preview, conversationId]);
    await audit(organizationId, userId, "template.sent", "conversation", conversationId, { name, language });
  } catch (error) {
    await pool.execute("UPDATE messages SET status = 'failed', error_message = ? WHERE id = ?", [error instanceof Error ? error.message : "Falha no envio", id]);
    throw error;
  } finally { publish(organizationId, { type: "message", conversationId }); }
  return { id };
}

export async function sendAgentMedia(organizationId: string, userId: string, conversationId: string, input: {
  buffer: Buffer; mimeType: string; fileName: string; caption?: string;
}) {
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT ct.wa_id AS waId, c.service_window_expires_at AS expiresAt
    FROM conversations c JOIN contacts ct ON ct.id = c.contact_id
    WHERE c.id = ? AND c.organization_id = ? LIMIT 1`, [conversationId, organizationId]);
  const conversation = rows[0];
  if (!conversation) throw new Error("Conversa não encontrada.");
  if (!conversation.expiresAt || new Date(conversation.expiresAt).getTime() <= Date.now()) throw new Error("A janela de atendimento encerrou. Envie um template aprovado.");
  const type = mediaTypeFromMime(input.mimeType);
  const id = crypto.randomUUID();
  const preview = input.caption || input.fileName || `[${type}]`;
  await pool.execute(`INSERT INTO messages
    (id, organization_id, conversation_id, direction, type, text_body, content, status, sent_by_user_id)
    VALUES (?, ?, ?, 'outbound', ?, ?, ?, 'queued', ?)`,
    [id, organizationId, conversationId, type, preview, JSON.stringify({ mimeType: input.mimeType, fileName: input.fileName }), userId]);
  try {
    const mediaId = await uploadMedia(input.buffer, input.mimeType, input.fileName);
    const result = await sendMedia(String(conversation.waId), type, mediaId, input.caption, input.fileName);
    await pool.execute("UPDATE messages SET meta_message_id = ?, content = ?, status = 'sent', sent_at = NOW(3) WHERE id = ?",
      [result.messageId, JSON.stringify({ mediaId, mimeType: input.mimeType, fileName: input.fileName, caption: input.caption ?? null }), id]);
    await pool.execute("UPDATE conversations SET last_message_preview = ?, last_message_at = NOW(3), status = 'open', first_response_at = COALESCE(first_response_at, NOW(3)) WHERE id = ?", [preview.slice(0, 500), conversationId]);
    await audit(organizationId, userId, "media.sent", "conversation", conversationId, { type, fileName: input.fileName });
  } catch (error) {
    await pool.execute("UPDATE messages SET status = 'failed', error_message = ? WHERE id = ?", [error instanceof Error ? error.message : "Falha no envio", id]);
    throw error;
  } finally { publish(organizationId, { type: "message", conversationId }); }
  return { id };
}

export async function getMessageMedia(organizationId: string, messageId: string) {
  const [rows] = await pool.execute<RowDataPacket[]>("SELECT type, content FROM messages WHERE id = ? AND organization_id = ? LIMIT 1", [messageId, organizationId]);
  const row = rows[0];
  if (!row || !["image", "audio", "video", "document", "sticker"].includes(String(row.type))) throw new Error("Mídia não encontrada.");
  const content = typeof row.content === "string" ? JSON.parse(row.content) : row.content;
  const mediaId = content?.mediaId ?? content?.[row.type]?.id;
  if (!mediaId) throw new Error("Identificador da mídia indisponível.");
  return downloadMedia(String(mediaId));
}

export async function listUsers(organizationId: string) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    "SELECT id, name, email, role FROM users WHERE organization_id = ? AND active = TRUE ORDER BY name", [organizationId]);
  return rows;
}

export async function updateContactName(organizationId: string, conversationId: string, name: string) {
  const [result] = await pool.execute<ResultSetHeader>(`UPDATE contacts ct JOIN conversations c ON c.contact_id = ct.id
    SET ct.name = ? WHERE c.id = ? AND c.organization_id = ?`, [name, conversationId, organizationId]);
  if (result.affectedRows) publish(organizationId, { type: "conversation", conversationId });
  return result.affectedRows > 0;
}

export async function listNotes(organizationId: string, conversationId: string) {
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT n.id, n.body, n.created_at AS createdAt, u.name AS userName
    FROM notes n JOIN users u ON u.id = n.user_id
    WHERE n.organization_id = ? AND n.conversation_id = ? ORDER BY n.created_at DESC LIMIT 100`, [organizationId, conversationId]);
  return rows;
}

export async function addNote(organizationId: string, userId: string, conversationId: string, body: string) {
  const id = crypto.randomUUID();
  await pool.execute("INSERT INTO notes (id, organization_id, conversation_id, user_id, body) VALUES (?, ?, ?, ?, ?)", [id, organizationId, conversationId, userId, body]);
  await audit(organizationId, userId, "note.created", "conversation", conversationId);
  publish(organizationId, { type: "note", conversationId });
  return { id };
}

export async function listQuickReplies(organizationId: string) {
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT id, shortcut, title, body FROM quick_replies
    WHERE organization_id = ? AND active = TRUE ORDER BY title`, [organizationId]);
  return rows;
}

export async function listTags(organizationId: string, conversationId: string) {
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT t.id, t.name, t.color FROM conversation_tags ct
    JOIN tags t ON t.id = ct.tag_id WHERE ct.conversation_id = ? AND t.organization_id = ? ORDER BY t.name`, [conversationId, organizationId]);
  return rows;
}

export async function replaceTags(organizationId: string, userId: string, conversationId: string, names: string[]) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [conversations] = await connection.execute<RowDataPacket[]>("SELECT id FROM conversations WHERE id = ? AND organization_id = ?", [conversationId, organizationId]);
    if (!conversations.length) throw new Error("Conversa não encontrada.");
    await connection.execute("DELETE FROM conversation_tags WHERE conversation_id = ?", [conversationId]);
    for (const name of names) {
      await connection.execute("INSERT IGNORE INTO tags (id, organization_id, name) VALUES (?, ?, ?)", [crypto.randomUUID(), organizationId, name]);
      await connection.execute(`INSERT INTO conversation_tags (conversation_id, tag_id)
        SELECT ?, id FROM tags WHERE organization_id = ? AND name = ?`, [conversationId, organizationId, name]);
    }
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  await audit(organizationId, userId, "tags.updated", "conversation", conversationId, { names });
  publish(organizationId, { type: "conversation", conversationId });
  return listTags(organizationId, conversationId);
}

export async function markConversationRead(organizationId: string, conversationId: string) {
  const [result] = await pool.execute<ResultSetHeader>("UPDATE conversations SET unread_count = 0 WHERE id = ? AND organization_id = ?", [conversationId, organizationId]);
  return result.affectedRows > 0;
}

export async function assignConversation(organizationId: string, conversationId: string, userId: string | null, actorUserId?: string) {
  if (userId) {
    const [users] = await pool.execute<RowDataPacket[]>("SELECT id FROM users WHERE id = ? AND organization_id = ? AND active = TRUE", [userId, organizationId]);
    if (!users.length) throw new Error("Atendente inválido.");
  }
  const [result] = await pool.execute<ResultSetHeader>("UPDATE conversations SET assigned_user_id = ?, status = 'open' WHERE id = ? AND organization_id = ?", [userId, conversationId, organizationId]);
  if (result.affectedRows) {
    await audit(organizationId, actorUserId ?? null, "conversation.assigned", "conversation", conversationId, { assignedUserId: userId });
    publish(organizationId, { type: "conversation", conversationId });
  }
  return result.affectedRows > 0;
}

export async function changeStatus(organizationId: string, conversationId: string, status: string) {
  const [result] = await pool.execute<ResultSetHeader>("UPDATE conversations SET status = ?, resolved_at = IF(? = 'resolved', NOW(3), NULL) WHERE id = ? AND organization_id = ?", [status, status, conversationId, organizationId]);
  if (result.affectedRows) publish(organizationId, { type: "conversation", conversationId });
  return result.affectedRows > 0;
}

export async function updateConversationRouting(organizationId: string, userId: string, conversationId: string, input: { teamId?: string | null; priority?: string }) {
  if (input.teamId) {
    const [teams] = await pool.execute<RowDataPacket[]>("SELECT id FROM teams WHERE id = ? AND organization_id = ? AND active = TRUE", [input.teamId, organizationId]);
    if (!teams.length) throw new Error("Equipe inválida.");
  }
  const assignments: string[] = []; const values: unknown[] = [];
  if (input.teamId !== undefined) { assignments.push("team_id = ?"); values.push(input.teamId); }
  if (input.priority !== undefined) { assignments.push("priority = ?"); values.push(input.priority); }
  if (!assignments.length) return false;
  values.push(conversationId, organizationId);
  const [result] = await pool.execute<ResultSetHeader>(`UPDATE conversations SET ${assignments.join(", ")} WHERE id = ? AND organization_id = ?`, values as any[]);
  if (result.affectedRows) { await audit(organizationId, userId, "conversation.routed", "conversation", conversationId, input); publish(organizationId, { type: "conversation", conversationId }); }
  return result.affectedRows > 0;
}

async function audit(organizationId: string, userId: string | null, action: string, entityType: string, entityId: string, metadata?: object) {
  await pool.execute(`INSERT INTO audit_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
    VALUES (?, ?, ?, ?, ?, ?)`, [organizationId, userId, action, entityType, entityId, metadata ? JSON.stringify(metadata) : null]);
}

function mediaTypeFromMime(mimeType: string): "image" | "audio" | "video" | "document" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "document";
}
