CREATE TABLE IF NOT EXISTS organizations (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  organization_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','supervisor','agent') NOT NULL DEFAULT 'agent',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_users_email (email),
  CONSTRAINT fk_users_org FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE IF NOT EXISTS contacts (
  id CHAR(36) PRIMARY KEY,
  organization_id CHAR(36) NOT NULL,
  wa_id VARCHAR(32) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  name VARCHAR(160) NULL,
  profile_name VARCHAR(160) NULL,
  custom_fields JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_contacts_org_wa (organization_id, wa_id),
  KEY idx_contacts_phone (phone),
  CONSTRAINT fk_contacts_org FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id CHAR(36) PRIMARY KEY,
  organization_id CHAR(36) NOT NULL,
  contact_id CHAR(36) NOT NULL,
  status ENUM('new','open','pending','resolved') NOT NULL DEFAULT 'new',
  assigned_user_id CHAR(36) NULL,
  unread_count INT UNSIGNED NOT NULL DEFAULT 0,
  service_window_expires_at DATETIME(3) NULL,
  last_message_preview VARCHAR(500) NULL,
  last_message_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_conversations_org_contact (organization_id, contact_id),
  KEY idx_conversations_inbox (organization_id, status, last_message_at),
  CONSTRAINT fk_conversations_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_conversations_contact FOREIGN KEY (contact_id) REFERENCES contacts(id),
  CONSTRAINT fk_conversations_agent FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id CHAR(36) PRIMARY KEY,
  organization_id CHAR(36) NOT NULL,
  conversation_id CHAR(36) NOT NULL,
  meta_message_id VARCHAR(255) NULL,
  direction ENUM('inbound','outbound') NOT NULL,
  type VARCHAR(40) NOT NULL,
  text_body TEXT NULL,
  content JSON NULL,
  status ENUM('received','queued','sent','delivered','read','failed') NOT NULL,
  error_code VARCHAR(64) NULL,
  error_message TEXT NULL,
  sent_by_user_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  sent_at DATETIME(3) NULL,
  delivered_at DATETIME(3) NULL,
  read_at DATETIME(3) NULL,
  UNIQUE KEY uq_messages_meta_id (meta_message_id),
  KEY idx_messages_timeline (conversation_id, created_at, id),
  CONSTRAINT fk_messages_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_messages_sender FOREIGN KEY (sent_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id CHAR(36) PRIMARY KEY,
  organization_id CHAR(36) NOT NULL,
  conversation_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_notes_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_notes_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_notes_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id CHAR(36) PRIMARY KEY,
  deduplication_key VARCHAR(255) NOT NULL,
  payload JSON NOT NULL,
  status ENUM('received','processed','failed') NOT NULL DEFAULT 'received',
  error_message TEXT NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  processed_at DATETIME(3) NULL,
  UNIQUE KEY uq_webhook_deduplication (deduplication_key)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  organization_id CHAR(36) NOT NULL,
  user_id CHAR(36) NULL,
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(80) NULL,
  metadata JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_audit_org_time (organization_id, created_at),
  CONSTRAINT fk_audit_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
