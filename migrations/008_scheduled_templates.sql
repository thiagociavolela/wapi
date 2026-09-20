ALTER TABLE scheduled_messages
  ADD COLUMN message_type ENUM('text', 'template') NOT NULL DEFAULT 'text' AFTER created_by_user_id,
  ADD COLUMN template_name VARCHAR(512) NULL AFTER body,
  ADD COLUMN template_language VARCHAR(20) NULL AFTER template_name,
  ADD COLUMN template_components JSON NULL AFTER template_language;
