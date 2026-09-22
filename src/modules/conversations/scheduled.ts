import crypto from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "../../database/pool.js";
import { publish } from "../realtime/events.js";
import { adminCanSendConversation, sendAgentTemplate, sendAgentText } from "./service.js";

type ScheduledInput = { body: string; scheduledFor: Date; messageType: "text" | "template"; templateName?: string; templateLanguage?: string; templateComponents?: unknown[] };

export async function createScheduledMessage(organizationId: string, userId: string, conversationId: string, input: ScheduledInput) {
  const [conversations] = await pool.execute<RowDataPacket[]>("SELECT id FROM conversations WHERE id = ? AND organization_id = ?", [conversationId, organizationId]);
  if (!conversations.length) throw new Error("Conversa não encontrada.");
  const id = crypto.randomUUID();
  await pool.execute(`INSERT INTO scheduled_messages
    (id, organization_id, conversation_id, created_by_user_id, message_type, body, template_name, template_language, template_components, scheduled_for)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, organizationId, conversationId, userId, input.messageType, input.body,
      input.templateName ?? null, input.templateLanguage ?? null, input.templateComponents ? JSON.stringify(input.templateComponents) : null, input.scheduledFor]);
  publish(organizationId, { type: "conversation", conversationId });
  return { id };
}

export async function listScheduledMessages(organizationId: string, conversationId: string) {
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT sm.id, sm.message_type AS messageType, sm.body, sm.template_name AS templateName,
    sm.template_language AS templateLanguage, sm.template_components AS templateComponents, sm.scheduled_for AS scheduledFor, sm.status,
    sm.error_message AS errorMessage, sm.created_at AS createdAt, u.name AS createdByName
    FROM scheduled_messages sm JOIN users u ON u.id = sm.created_by_user_id
    WHERE sm.organization_id = ? AND sm.conversation_id = ? AND sm.status IN ('pending', 'processing', 'failed')
    ORDER BY sm.scheduled_for`, [organizationId, conversationId]);
  return rows;
}

export async function updateScheduledMessage(organizationId: string, id: string, input: ScheduledInput) {
  const [result] = await pool.execute<ResultSetHeader>(`UPDATE scheduled_messages SET message_type = ?, body = ?, template_name = ?,
    template_language = ?, template_components = ?, scheduled_for = ?, error_message = NULL
    WHERE id = ? AND organization_id = ? AND status = 'pending'`, [input.messageType, input.body, input.templateName ?? null,
    input.templateLanguage ?? null, input.templateComponents ? JSON.stringify(input.templateComponents) : null, input.scheduledFor, id, organizationId]);
  if (!result.affectedRows) throw new Error("Este agendamento não está mais disponível para edição.");
  return { id };
}

export async function cancelScheduledMessage(organizationId: string, id: string) {
  const [result] = await pool.execute<ResultSetHeader>(`UPDATE scheduled_messages SET status = 'cancelled', processed_at = NOW(3)
    WHERE id = ? AND organization_id = ? AND status = 'pending'`, [id, organizationId]);
  return result.affectedRows > 0;
}

let timer: NodeJS.Timeout | undefined;
let processing = false;

async function processDueMessages() {
  if (processing) return;
  processing = true;
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(`SELECT id, organization_id AS organizationId, conversation_id AS conversationId,
      created_by_user_id AS userId, message_type AS messageType, body, template_name AS templateName,
      template_language AS templateLanguage, template_components AS templateComponents
      FROM scheduled_messages WHERE status = 'pending' AND scheduled_for <= NOW(3)
      ORDER BY scheduled_for LIMIT 20`);
    for (const item of rows) {
      const [claim] = await pool.execute<ResultSetHeader>("UPDATE scheduled_messages SET status = 'processing' WHERE id = ? AND status = 'pending'", [item.id]);
      if (!claim.affectedRows) continue;
      try {
        const [authors] = await pool.execute<RowDataPacket[]>("SELECT role FROM users WHERE id = ? AND organization_id = ? LIMIT 1", [item.userId, item.organizationId]);
        if (authors[0]?.role === "admin" && !await adminCanSendConversation(String(item.organizationId), String(item.userId), String(item.conversationId))) {
          throw new Error("O administrador precisa assumir a conversa antes do envio agendado.");
        }
        const sent = item.messageType === "template"
          ? await sendAgentTemplate(String(item.organizationId), String(item.userId), String(item.conversationId), String(item.templateName), String(item.templateLanguage),
              typeof item.templateComponents === "string" ? JSON.parse(item.templateComponents) : (item.templateComponents || []))
          : await sendAgentText(String(item.organizationId), String(item.userId), String(item.conversationId), String(item.body));
        await pool.execute("UPDATE scheduled_messages SET status = 'sent', message_id = ?, processed_at = NOW(3) WHERE id = ?", [sent.id, item.id]);
      } catch (error) {
        await pool.execute("UPDATE scheduled_messages SET status = 'failed', error_message = ?, processed_at = NOW(3) WHERE id = ?", [error instanceof Error ? error.message : "Falha no envio", item.id]);
      }
      publish(String(item.organizationId), { type: "conversation", conversationId: String(item.conversationId) });
    }
  } finally { processing = false; }
}

export function startScheduledMessageWorker() {
  void processDueMessages();
  timer = setInterval(() => void processDueMessages(), 15000);
  timer.unref();
}
