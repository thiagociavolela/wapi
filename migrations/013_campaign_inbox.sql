ALTER TABLE conversations
  MODIFY COLUMN status ENUM('new','open','pending','resolved','campaign') NOT NULL DEFAULT 'new';

-- Recover campaign-only conversations already placed in New. Never move an
-- assigned conversation, an unread reply, or one with customer/agent history.
UPDATE conversations c
SET c.status = 'campaign', c.first_response_due_at = NULL,
    c.first_response_at = NULL, c.resolution_due_at = NULL, c.resolved_at = NULL
WHERE c.status = 'new' AND c.assigned_user_id IS NULL AND c.unread_count = 0
  AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id
    AND m.direction = 'outbound' AND JSON_UNQUOTE(JSON_EXTRACT(m.content, '$.origin')) = 'campaign')
  AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id
    AND (m.direction = 'inbound' OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(m.content, '$.origin')), '') <> 'campaign'));
