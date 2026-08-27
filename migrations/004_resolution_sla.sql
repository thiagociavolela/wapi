ALTER TABLE conversations
  ADD COLUMN resolution_due_at DATETIME(3) NULL AFTER first_response_at,
  ADD KEY idx_conversations_resolution_sla (organization_id, resolution_due_at, resolved_at);

UPDATE conversations c
JOIN sla_policies s ON s.organization_id = c.organization_id
SET c.resolution_due_at = DATE_ADD(c.created_at, INTERVAL s.resolution_minutes MINUTE)
WHERE c.resolved_at IS NULL AND c.resolution_due_at IS NULL;
