CREATE TABLE IF NOT EXISTS teams (
  id CHAR(36) PRIMARY KEY,
  organization_id CHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  color VARCHAR(20) NOT NULL DEFAULT '#6657e8',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_teams_org_name (organization_id, name),
  CONSTRAINT fk_teams_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (team_id, user_id),
  CONSTRAINT fk_team_members_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  CONSTRAINT fk_team_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sla_policies (
  organization_id CHAR(36) PRIMARY KEY,
  first_response_minutes INT UNSIGNED NOT NULL DEFAULT 15,
  resolution_minutes INT UNSIGNED NOT NULL DEFAULT 480,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_sla_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

ALTER TABLE conversations
  ADD COLUMN team_id CHAR(36) NULL AFTER assigned_user_id,
  ADD COLUMN priority ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal' AFTER status,
  ADD COLUMN first_response_due_at DATETIME(3) NULL AFTER service_window_expires_at,
  ADD COLUMN first_response_at DATETIME(3) NULL AFTER first_response_due_at,
  ADD COLUMN resolved_at DATETIME(3) NULL AFTER first_response_at,
  ADD KEY idx_conversations_team (organization_id, team_id, status),
  ADD KEY idx_conversations_sla (organization_id, first_response_due_at, first_response_at),
  ADD CONSTRAINT fk_conversations_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;

INSERT IGNORE INTO sla_policies (organization_id)
SELECT id FROM organizations;

INSERT IGNORE INTO teams (id, organization_id, name, color)
SELECT UUID(), id, 'Atendimento', '#6657e8' FROM organizations;

INSERT IGNORE INTO team_members (team_id, user_id)
SELECT t.id, u.id FROM teams t JOIN users u ON u.organization_id = t.organization_id WHERE t.name = 'Atendimento';

UPDATE conversations c
JOIN sla_policies s ON s.organization_id = c.organization_id
SET c.first_response_due_at = DATE_ADD(COALESCE(c.last_message_at, c.created_at), INTERVAL s.first_response_minutes MINUTE)
WHERE c.first_response_at IS NULL AND c.first_response_due_at IS NULL;
