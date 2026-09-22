import crypto from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "../../database/pool.js";
import { publish } from "../realtime/events.js";
import { downloadMedia, sendMedia, sendReaction, sendTemplate, sendText, sendTypingIndicator, uploadMedia } from "../meta/client.js";

const DEFAULT_ORG_SQL = "SELECT id FROM organizations ORDER BY created_at LIMIT 1";

export async function defaultOrganizationId() {
  const [rows] = await pool.query<RowDataPacket[]>(DEFAULT_ORG_SQL);
  if (!rows[0]?.id) throw new Error("Nenhuma organização cadastrada.");
  return String(rows[0].id);
}

export async function listConversations(organizationId: string, search = "", status?: "new" | "open" | "pending" | "resolved", all = false) {
  const term = `%${search.trim()}%`;
  const [rows] = await pool.execute<RowDataPacket[]>(`
    SELECT c.id, c.status, c.priority, c.unread_count AS unreadCount,
      c.service_window_expires_at AS serviceWindowExpiresAt,
      c.first_response_due_at AS firstResponseDueAt, c.first_response_at AS firstResponseAt, c.resolution_due_at AS resolutionDueAt,
      c.last_message_preview AS lastMessagePreview, c.last_message_at AS lastMessageAt,
      (SELECT MAX(im.created_at) FROM messages im WHERE im.conversation_id = c.id AND im.direction = 'inbound') AS lastCustomerMessageAt,
      ct.id AS contactId, ct.name, ct.profile_name AS profileName, ct.phone, ct.wa_id AS waId,
      c.assigned_user_id AS assignedUserId, u.name AS assignedUserName, t.id AS teamId, t.name AS teamName, t.color AS teamColor,
      (SELECT GROUP_CONCAT(t.name ORDER BY t.name SEPARATOR '||') FROM conversation_tags ctag JOIN tags t ON t.id = ctag.tag_id WHERE ctag.conversation_id = c.id) AS tagNames
    FROM conversations c
    JOIN contacts ct ON ct.id = c.contact_id
    LEFT JOIN users u ON u.id = c.assigned_user_id
    LEFT JOIN teams t ON t.id = c.team_id
    WHERE c.organization_id = ? AND (? = '' OR c.status = ?) AND (? = '%%' OR ct.name LIKE ? OR ct.profile_name LIKE ? OR ct.phone LIKE ?)
    ORDER BY c.last_message_at DESC, c.created_at DESC ${all ? "" : "LIMIT 100"}`,
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

export async function adminCanSendConversation(organizationId: string, userId: string, conversationId: string) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    "SELECT assigned_user_id AS assignedUserId FROM conversations WHERE id = ? AND organization_id = ? LIMIT 1",
    [conversationId, organizationId]
  );
  return Boolean(rows[0]) && String(rows[0]?.assignedUserId || "") === userId;
}

export async function listContacts(organizationId: string, search = "", status?: "new" | "open" | "pending" | "resolved", page = 1, limit = 25) {
  const term = `%${search.trim()}%`;
  const offset = (page - 1) * limit;
  const where = `ct.organization_id = ? AND (? = '' OR c.status = ?)
      AND (? = '%%' OR ct.name LIKE ? OR ct.profile_name LIKE ? OR ct.phone LIKE ? OR ct.wa_id LIKE ?)`;
  const params = [organizationId, status || "", status || "", term, term, term, term, term];
  const [itemsResult, countResult] = await Promise.all([
    pool.execute<RowDataPacket[]>(`
    SELECT ct.id AS contactId, ct.name, ct.profile_name AS profileName, ct.phone, ct.wa_id AS waId,
      ct.created_at AS contactCreatedAt, c.id, c.status, c.priority, c.unread_count AS unreadCount,
      c.service_window_expires_at AS serviceWindowExpiresAt, c.last_message_preview AS lastMessagePreview,
      c.last_message_at AS lastMessageAt, c.assigned_user_id AS assignedUserId, u.name AS assignedUserName,
      t.id AS teamId, t.name AS teamName, t.color AS teamColor,
      (SELECT MAX(im.created_at) FROM messages im WHERE im.conversation_id = c.id AND im.direction = 'inbound') AS lastCustomerMessageAt
    FROM contacts ct
    LEFT JOIN conversations c ON c.contact_id = ct.id AND c.organization_id = ct.organization_id
    LEFT JOIN users u ON u.id = c.assigned_user_id
    LEFT JOIN teams t ON t.id = c.team_id
    WHERE ${where}
    ORDER BY COALESCE(c.last_message_at, ct.updated_at) DESC, ct.created_at DESC
    LIMIT ? OFFSET ?`, [...params, limit, offset]),
    pool.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM contacts ct
      LEFT JOIN conversations c ON c.contact_id = ct.id AND c.organization_id = ct.organization_id
      WHERE ${where}`, params)
  ]);
  const items = itemsResult[0];
  const total = Number(countResult[0][0]?.total || 0);
  return { items, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } };
}

export async function createContact(organizationId: string, name: string, phone: string) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM contacts WHERE organization_id = ? AND wa_id = ? LIMIT 1", [organizationId, phone]);
    if (existing.length) throw new Error("Este telefone já está cadastrado.");
    const contactId = crypto.randomUUID(); const conversationId = crypto.randomUUID();
    await connection.execute(
      "INSERT INTO contacts (id, organization_id, wa_id, phone, name) VALUES (?, ?, ?, ?, ?)",
      [contactId, organizationId, phone, phone, name]);
    await connection.execute(`INSERT INTO conversations
      (id, organization_id, contact_id, status, first_response_due_at, resolution_due_at)
      SELECT ?, ?, ?, 'new', DATE_ADD(NOW(3), INTERVAL COALESCE(s.first_response_minutes, 15) MINUTE),
        DATE_ADD(NOW(3), INTERVAL COALESCE(s.resolution_minutes, 480) MINUTE)
      FROM organizations o LEFT JOIN sla_policies s ON s.organization_id = o.id WHERE o.id = ?`,
      [conversationId, organizationId, contactId, organizationId]);
    await connection.commit();
    publish(organizationId, { type: "conversation", conversationId });
    return { id: conversationId, contactId, name, phone, waId: phone, status: "new", unreadCount: 0 };
  } catch (error) {
    await connection.rollback(); throw error;
  } finally { connection.release(); }
}

export async function importContacts(organizationId: string, contacts: Array<{ name: string; phone: string }>) {
  const connection = await pool.getConnection();
  let created = 0; let skipped = 0;
  try {
    await connection.beginTransaction();
    for (const contact of contacts) {
      const [existing] = await connection.execute<RowDataPacket[]>(
        "SELECT id FROM contacts WHERE organization_id = ? AND wa_id = ? LIMIT 1", [organizationId, contact.phone]);
      if (existing.length) { skipped += 1; continue; }
      const contactId = crypto.randomUUID(); const conversationId = crypto.randomUUID();
      await connection.execute("INSERT INTO contacts (id, organization_id, wa_id, phone, name) VALUES (?, ?, ?, ?, ?)",
        [contactId, organizationId, contact.phone, contact.phone, contact.name]);
      await connection.execute(`INSERT INTO conversations
        (id, organization_id, contact_id, status, first_response_due_at, resolution_due_at)
        SELECT ?, ?, ?, 'new', DATE_ADD(NOW(3), INTERVAL COALESCE(s.first_response_minutes, 15) MINUTE),
          DATE_ADD(NOW(3), INTERVAL COALESCE(s.resolution_minutes, 480) MINUTE)
        FROM organizations o LEFT JOIN sla_policies s ON s.organization_id = o.id WHERE o.id = ?`,
        [conversationId, organizationId, contactId, organizationId]);
      created += 1;
    }
    await connection.commit();
    if (created) publish(organizationId, { type: "conversation" });
    return { created, skipped };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function getMessages(organizationId: string, conversationId: string, before?: string) {
  const params: any[] = [organizationId, conversationId];
  let cursor = "";
  if (before) { cursor = "AND m.created_at < ?"; params.push(before); }
  const [rows] = await pool.execute<RowDataPacket[]>(`
    SELECT m.id, m.meta_message_id AS metaMessageId, m.reply_to_message_id AS replyToMessageId,
      m.reply_to_meta_message_id AS replyToMetaMessageId, m.direction, m.type,
      m.text_body AS textBody, m.content, m.status, m.error_message AS errorMessage,
      m.created_at AS createdAt, u.name AS senderName, rm.text_body AS replyTextBody,
      rm.type AS replyType, rm.direction AS replyDirection, ru.name AS replySenderName
    FROM messages m LEFT JOIN users u ON u.id = m.sent_by_user_id
    LEFT JOIN messages rm ON rm.id = m.reply_to_message_id LEFT JOIN users ru ON ru.id = rm.sent_by_user_id
    WHERE m.organization_id = ? AND m.conversation_id = ? ${cursor}
    ORDER BY m.created_at DESC, m.id DESC LIMIT 51`, params);
  const hasMore = rows.length > 50;
  const items = rows.slice(0, 50).reverse();
  if (items.length) {
    const ids = items.map((item) => item.id); const placeholders = ids.map(() => "?").join(",");
    const [reactions] = await pool.execute<RowDataPacket[]>(`SELECT target_message_id AS targetMessageId, emoji, direction, actor_key AS actorKey
      FROM message_reactions WHERE organization_id = ? AND target_message_id IN (${placeholders}) ORDER BY created_at`, [organizationId, ...ids]);
    for (const item of items) item.reactions = reactions.filter((reaction) => reaction.targetMessageId === item.id);
  }
  return { items, hasMore };
}

const typingSignals = new Map<string, number>();
export async function signalAgentTyping(organizationId: string, conversationId: string) {
  const key = `${organizationId}:${conversationId}`; const now = Date.now();
  if (now - (typingSignals.get(key) || 0) < 8000) return { ok: true, throttled: true };
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT m.meta_message_id AS metaMessageId FROM messages m
    WHERE m.organization_id = ? AND m.conversation_id = ? AND m.direction = 'inbound' AND m.meta_message_id IS NOT NULL
    ORDER BY m.created_at DESC LIMIT 1`, [organizationId, conversationId]);
  if (!rows[0]?.metaMessageId) return { ok: true, skipped: true };
  await sendTypingIndicator(String(rows[0].metaMessageId)); typingSignals.set(key, now);
  return { ok: true };
}

export async function sendAgentText(organizationId: string, userId: string, conversationId: string, body: string, clientId?: string, replyToMessageId?: string) {
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
  let replyToMetaMessageId: string | null = null;
  if (replyToMessageId) {
    const [replyRows] = await pool.execute<RowDataPacket[]>("SELECT meta_message_id AS metaMessageId FROM messages WHERE id = ? AND conversation_id = ? AND organization_id = ? LIMIT 1", [replyToMessageId, conversationId, organizationId]);
    replyToMetaMessageId = replyRows[0]?.metaMessageId ? String(replyRows[0].metaMessageId) : null;
    if (!replyToMetaMessageId) throw new Error("A mensagem selecionada ainda não pode ser respondida.");
  }
  await pool.execute(`INSERT INTO messages
    (id, organization_id, conversation_id, reply_to_message_id, reply_to_meta_message_id, direction, type, text_body, status, sent_by_user_id)
    VALUES (?, ?, ?, ?, ?, 'outbound', 'text', ?, 'queued', ?)`, [id, organizationId, conversationId, replyToMessageId ?? null, replyToMetaMessageId, body, userId]);
  try {
    const result = await sendText(String(conversation.waId), body, replyToMetaMessageId ?? undefined);
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

export async function reactToMessage(organizationId: string, userId: string, conversationId: string, messageId: string, emoji: string) {
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT m.id, m.meta_message_id AS metaMessageId, ct.wa_id AS waId
    FROM messages m JOIN conversations c ON c.id = m.conversation_id JOIN contacts ct ON ct.id = c.contact_id
    WHERE m.id = ? AND m.conversation_id = ? AND m.organization_id = ? LIMIT 1`, [messageId, conversationId, organizationId]);
  const target = rows[0]; if (!target?.metaMessageId) throw new Error("Esta mensagem ainda não aceita reações.");
  await sendReaction(String(target.waId), String(target.metaMessageId), emoji);
  if (!emoji) await pool.execute("DELETE FROM message_reactions WHERE organization_id = ? AND target_meta_message_id = ? AND actor_key = 'business'", [organizationId, target.metaMessageId]);
  else await pool.execute(`INSERT INTO message_reactions
    (id, organization_id, conversation_id, target_message_id, target_meta_message_id, direction, actor_key, emoji, sent_by_user_id)
    VALUES (?, ?, ?, ?, ?, 'outbound', 'business', ?, ?)
    ON DUPLICATE KEY UPDATE emoji = VALUES(emoji), sent_by_user_id = VALUES(sent_by_user_id), updated_at = NOW(3)`,
    [crypto.randomUUID(), organizationId, conversationId, target.id, target.metaMessageId, emoji, userId]);
  publish(organizationId, { type: "reaction", conversationId, messageId }); return { ok: true };
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
  buffer: Buffer; mimeType: string; fileName: string; caption?: string; voice?: boolean;
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
    await pool.execute("UPDATE messages SET content = ? WHERE id = ?", [JSON.stringify({ mediaId, mimeType: input.mimeType, fileName: input.fileName, caption: input.caption ?? null, voice: Boolean(input.voice) }), id]);
    const result = await sendMedia(String(conversation.waId), type, mediaId, input.caption, input.fileName, input.voice);
    await pool.execute("UPDATE messages SET meta_message_id = ?, content = ?, status = 'sent', sent_at = NOW(3) WHERE id = ?",
      [result.messageId, JSON.stringify({ mediaId, mimeType: input.mimeType, fileName: input.fileName, caption: input.caption ?? null, voice: Boolean(input.voice) }), id]);
    await pool.execute("UPDATE conversations SET last_message_preview = ?, last_message_at = NOW(3), status = 'open', first_response_at = COALESCE(first_response_at, NOW(3)) WHERE id = ?", [preview.slice(0, 500), conversationId]);
    await audit(organizationId, userId, "media.sent", "conversation", conversationId, { type, fileName: input.fileName });
  } catch (error) {
    await pool.execute("UPDATE messages SET status = 'failed', error_message = ? WHERE id = ?", [error instanceof Error ? error.message : "Falha no envio", id]);
    throw error;
  } finally { publish(organizationId, { type: "message", conversationId }); }
  return { id };
}

export async function retryAgentMessage(organizationId: string, userId: string, conversationId: string, messageId: string) {
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT m.id, m.type, m.content, m.text_body AS textBody,
    m.reply_to_meta_message_id AS replyToMetaMessageId, ct.wa_id AS waId, c.service_window_expires_at AS expiresAt
    FROM messages m JOIN conversations c ON c.id = m.conversation_id JOIN contacts ct ON ct.id = c.contact_id
    WHERE m.id = ? AND m.conversation_id = ? AND m.organization_id = ? AND m.direction = 'outbound' AND m.status = 'failed' LIMIT 1`,
  [messageId, conversationId, organizationId]);
  const message = rows[0];
  if (!message) throw new Error("Esta mensagem não está disponível para reenvio.");
  const type = String(message.type);
  if (type !== "template" && (!message.expiresAt || new Date(message.expiresAt).getTime() <= Date.now())) throw new Error("A janela de atendimento encerrou. Envie um template aprovado.");
  const content = typeof message.content === "string" ? JSON.parse(message.content || "{}") : (message.content || {});
  const [claimed] = await pool.execute<ResultSetHeader>("UPDATE messages SET status = 'queued', error_code = NULL, error_message = NULL WHERE id = ? AND organization_id = ? AND status = 'failed'", [messageId, organizationId]);
  if (!claimed.affectedRows) throw new Error("A mensagem já está sendo reenviada.");
  publish(organizationId, { type: "message", conversationId });
  try {
    let result: { messageId: string };
    if (type === "text") {
      result = await sendText(String(message.waId), String(message.textBody ?? ""), message.replyToMetaMessageId ? String(message.replyToMetaMessageId) : undefined);
    } else if (type === "template") {
      const name = content.name ?? content.template;
      if (!name) throw new Error("Os dados do template não estão mais disponíveis.");
      result = await sendTemplate(String(message.waId), String(name), String(content.language ?? "pt_BR"), Array.isArray(content.components) ? content.components : []);
    } else if (["image", "audio", "video", "document"].includes(type)) {
      if (!content.mediaId) throw new Error("O arquivo original não está mais disponível para reenvio.");
      result = await sendMedia(String(message.waId), type as "image" | "audio" | "video" | "document", String(content.mediaId), content.caption ?? undefined, content.fileName ?? undefined, Boolean(content.voice));
    } else {
      throw new Error("Este tipo de mensagem não pode ser reenviado.");
    }
    await pool.execute("UPDATE messages SET meta_message_id = ?, status = 'sent', error_code = NULL, error_message = NULL, sent_at = NOW(3) WHERE id = ?", [result.messageId, messageId]);
    await pool.execute("UPDATE conversations SET last_message_preview = ?, last_message_at = NOW(3), status = 'open', first_response_at = COALESCE(first_response_at, NOW(3)) WHERE id = ?", [String(message.textBody ?? `[${type}]`).slice(0, 500), conversationId]);
    await audit(organizationId, userId, "message.retried", "conversation", conversationId, { messageId, type });
    return { id: messageId, metaMessageId: result.messageId };
  } catch (error) {
    await pool.execute("UPDATE messages SET status = 'failed', error_message = ? WHERE id = ?", [error instanceof Error ? error.message : "Falha no reenvio", messageId]);
    throw error;
  } finally {
    publish(organizationId, { type: "message", conversationId });
  }
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

export async function listUsers(organizationId: string, actorRole = "admin") {
  const [rows] = await pool.execute<RowDataPacket[]>(
    "SELECT id, name, email, role FROM users WHERE organization_id = ? AND active = TRUE AND (? = 'admin' OR role <> 'admin') ORDER BY name", [organizationId, actorRole]);
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

export async function listQuickReplies(organizationId: string, userId: string) {
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT id, shortcut, title, body, user_id AS userId FROM quick_replies
    WHERE organization_id = ? AND active = TRUE AND (user_id IS NULL OR user_id = ?)
    ORDER BY user_id IS NULL DESC, title`, [organizationId, userId]);
  return rows;
}

export async function createQuickReply(organizationId: string, userId: string, input: { shortcut: string; title: string; body: string }) {
  const id = crypto.randomUUID();
  try {
    await pool.execute(`INSERT INTO quick_replies (id, organization_id, user_id, shortcut, title, body)
      VALUES (?, ?, ?, ?, ?, ?)`, [id, organizationId, userId, input.shortcut, input.title, input.body]);
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") throw new Error("Você já possui uma mensagem rápida com este atalho.");
    throw error;
  }
  return { id, ...input, userId };
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

export async function markConversationUnread(organizationId: string, conversationId: string) {
  const [result] = await pool.execute<ResultSetHeader>("UPDATE conversations SET unread_count = GREATEST(unread_count, 1) WHERE id = ? AND organization_id = ?", [conversationId, organizationId]);
  if (result.affectedRows) publish(organizationId, { type: "conversation", conversationId });
  return result.affectedRows > 0;
}

export async function clearConversation(organizationId: string, conversationId: string, actorUserId: string) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM conversations WHERE id = ? AND organization_id = ? FOR UPDATE", [conversationId, organizationId]
    );
    if (!rows.length) { await connection.rollback(); return false; }
    await connection.execute("DELETE FROM integration_message_jobs WHERE conversation_id = ? AND organization_id = ?", [conversationId, organizationId]);
    await connection.execute("DELETE FROM scheduled_messages WHERE conversation_id = ? AND organization_id = ?", [conversationId, organizationId]);
    await connection.execute("DELETE FROM messages WHERE conversation_id = ? AND organization_id = ?", [conversationId, organizationId]);
    await connection.execute("UPDATE conversations SET last_message_preview = NULL, last_message_at = NULL, unread_count = 0 WHERE id = ? AND organization_id = ?", [conversationId, organizationId]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  await audit(organizationId, actorUserId, "conversation.cleared", "conversation", conversationId);
  publish(organizationId, { type: "conversation", conversationId });
  return true;
}

export async function deleteConversationContact(organizationId: string, conversationId: string, actorUserId: string) {
  const connection = await pool.getConnection();
  let contactId: string;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT contact_id AS contactId FROM conversations WHERE id = ? AND organization_id = ? FOR UPDATE", [conversationId, organizationId]
    );
    if (!rows[0]) { await connection.rollback(); return false; }
    contactId = String(rows[0].contactId);
    await connection.execute("DELETE FROM conversations WHERE id = ? AND organization_id = ?", [conversationId, organizationId]);
    await connection.execute("DELETE FROM contacts WHERE id = ? AND organization_id = ?", [contactId, organizationId]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  await audit(organizationId, actorUserId, "contact.deleted", "contact", contactId!);
  publish(organizationId, { type: "conversation", conversationId });
  return true;
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

export async function openConversationForAgent(organizationId: string, userId: string, conversationId: string) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<RowDataPacket[]>(`SELECT c.status, c.assigned_user_id AS assignedUserId, u.name AS assignedUserName
      FROM conversations c LEFT JOIN users u ON u.id = c.assigned_user_id
      WHERE c.id = ? AND c.organization_id = ? FOR UPDATE`, [conversationId, organizationId]);
    const conversation = rows[0]; if (!conversation) throw new Error("Conversa não encontrada.");
    if (conversation.status === "open" && conversation.assignedUserId && String(conversation.assignedUserId) !== userId) {
      throw new Error(`Esta conversa já está em andamento com o atendente ${conversation.assignedUserName || "responsável"}.`);
    }
    await connection.execute("UPDATE conversations SET status = 'open', assigned_user_id = COALESCE(assigned_user_id, ?), resolved_at = NULL WHERE id = ? AND organization_id = ?", [userId, conversationId, organizationId]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  await audit(organizationId, userId, "conversation.opened", "conversation", conversationId);
  publish(organizationId, { type: "conversation", conversationId }); return { ok: true };
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
