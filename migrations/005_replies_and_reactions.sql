ALTER TABLE messages
  ADD COLUMN reply_to_message_id CHAR(36) NULL AFTER meta_message_id,
  ADD COLUMN reply_to_meta_message_id VARCHAR(255) NULL AFTER reply_to_message_id,
  ADD KEY idx_messages_reply (organization_id, reply_to_meta_message_id),
  ADD CONSTRAINT fk_messages_reply FOREIGN KEY (reply_to_message_id) REFERENCES messages(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS message_reactions (
  id CHAR(36) PRIMARY KEY,
  organization_id CHAR(36) NOT NULL,
  conversation_id CHAR(36) NOT NULL,
  target_message_id CHAR(36) NULL,
  target_meta_message_id VARCHAR(255) NOT NULL,
  direction ENUM('inbound','outbound') NOT NULL,
  actor_key VARCHAR(255) NOT NULL,
  emoji VARCHAR(32) NOT NULL,
  sent_by_user_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_message_reaction_actor (organization_id, target_meta_message_id, actor_key),
  KEY idx_reactions_message (target_message_id),
  CONSTRAINT fk_reactions_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_reactions_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_reactions_message FOREIGN KEY (target_message_id) REFERENCES messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_reactions_user FOREIGN KEY (sent_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
