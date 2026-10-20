import { pool } from "../../database/pool.js";
import { publish } from "../realtime/events.js";

export async function recordCampaignSend(organizationId: string, conversationId: string, messageId: string, preview: string) {
  // The predicate is checked when the row is updated. A customer reply or an
  // agent taking the conversation while the Meta request runs must win.
  await pool.execute(`UPDATE conversations c
    SET c.status = 'campaign', c.first_response_due_at = NULL, c.first_response_at = NULL,
      c.resolution_due_at = NULL, c.resolved_at = NULL
    WHERE c.organization_id = ? AND c.id = ? AND c.assigned_user_id IS NULL AND c.unread_count = 0
      AND (c.status = 'resolved' OR (c.status = 'new' AND NOT EXISTS (
        SELECT 1 FROM messages history WHERE history.conversation_id = c.id
        AND (history.direction = 'inbound' OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history.content, '$.origin')), '') <> 'campaign')
      )))`, [organizationId, conversationId]);
  // A delayed campaign send must not overwrite the preview of a newer reply.
  await pool.execute(`UPDATE conversations c JOIN messages m ON m.id = ? AND m.conversation_id = c.id
    SET c.last_message_preview = ?, c.last_message_at = m.created_at
    WHERE c.organization_id = ? AND c.id = ? AND (c.last_message_at IS NULL OR c.last_message_at <= m.created_at)`,
  [messageId, preview.slice(0, 500), organizationId, conversationId]);
  publish(organizationId, { type: "conversation", conversationId });
}
