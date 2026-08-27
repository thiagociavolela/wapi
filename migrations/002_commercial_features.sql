CREATE TABLE IF NOT EXISTS tags (
  id CHAR(36) PRIMARY KEY,
  organization_id CHAR(36) NOT NULL,
  name VARCHAR(60) NOT NULL,
  color VARCHAR(20) NOT NULL DEFAULT '#6657e8',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_tags_org_name (organization_id, name),
  CONSTRAINT fk_tags_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS conversation_tags (
  conversation_id CHAR(36) NOT NULL,
  tag_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (conversation_id, tag_id),
  CONSTRAINT fk_conversation_tags_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_conversation_tags_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quick_replies (
  id CHAR(36) PRIMARY KEY,
  organization_id CHAR(36) NOT NULL,
  shortcut VARCHAR(40) NOT NULL,
  title VARCHAR(100) NOT NULL,
  body TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_quick_replies_org_shortcut (organization_id, shortcut),
  CONSTRAINT fk_quick_replies_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

INSERT IGNORE INTO quick_replies (id, organization_id, shortcut, title, body)
SELECT UUID(), id, '/saudacao', 'Saudação', 'Olá! Como posso ajudar você hoje?' FROM organizations;

INSERT IGNORE INTO quick_replies (id, organization_id, shortcut, title, body)
SELECT UUID(), id, '/aguarde', 'Solicitar espera', 'Só um momento, por favor. Já estou verificando isso para você.' FROM organizations;

INSERT IGNORE INTO quick_replies (id, organization_id, shortcut, title, body)
SELECT UUID(), id, '/encerrar', 'Encerramento', 'Foi um prazer ajudar! Se precisar de algo mais, estamos à disposição.' FROM organizations;
