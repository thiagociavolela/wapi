CREATE TABLE scheduled_messages (
  id CHAR(36) PRIMARY KEY,
  organization_id CHAR(36) NOT NULL,
  conversation_id CHAR(36) NOT NULL,
  created_by_user_id CHAR(36) NOT NULL,
  body VARCHAR(4096) NOT NULL,
  scheduled_for DATETIME(3) NOT NULL,
  status ENUM('pending', 'processing', 'sent', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
  message_id CHAR(36) NULL,
  error_message TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  processed_at DATETIME(3) NULL,
  INDEX idx_scheduled_due (status, scheduled_for),
  INDEX idx_scheduled_conversation (organization_id, conversation_id, created_at),
  CONSTRAINT fk_scheduled_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_scheduled_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_scheduled_user FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_scheduled_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
);
