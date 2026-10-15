-- Match the inbox ordering both with and without a status filter.
ALTER TABLE conversations
  ADD KEY idx_conversations_ordered (organization_id, last_message_at, created_at, id),
  ADD KEY idx_conversations_status_ordered (organization_id, status, last_message_at, created_at, id),
  ADD KEY idx_conversations_agent_ordered (organization_id, assigned_user_id, last_message_at, created_at, id);

-- Avoid scanning outgoing history to find the last inbound message.
ALTER TABLE messages
  ADD KEY idx_messages_last_inbound (conversation_id, direction, created_at);
