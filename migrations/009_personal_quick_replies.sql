ALTER TABLE quick_replies
  DROP INDEX uq_quick_replies_org_shortcut,
  ADD COLUMN user_id CHAR(36) NULL AFTER organization_id,
  ADD UNIQUE KEY uq_quick_replies_user_shortcut (organization_id, user_id, shortcut),
  ADD INDEX idx_quick_replies_user (organization_id, user_id, active),
  ADD CONSTRAINT fk_quick_replies_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
