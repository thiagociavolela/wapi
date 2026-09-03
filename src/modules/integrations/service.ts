import crypto from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "../../database/pool.js";
import { defaultOrganizationId } from "../conversations/service.js";
import { listMessageTemplates, sendTemplate } from "../meta/client.js";
import { publish } from "../realtime/events.js";

type TemplateDefinition = { name: string; status: string; language: string; category: string; components: Array<Record<string, any>> };
export type IntegrationMessageInput = { to: string; contactName?: string; template: string; language: string; parameters: string[]; sendAt?: Date; externalId?: string; metadata?: Record<string, unknown> };
let templateCache: { expiresAt: number; items: TemplateDefinition[] } | null = null;

const templateAliases: Record<string, string> = {
  pedido_pendente_finalizacao: "pedido_pendente_finalizacao_br"
};

async function approvedTemplates() {
  if (templateCache && templateCache.expiresAt > Date.now()) return templateCache.items;
  const response = await listMessageTemplates();
  const items = response.data.filter((item) => item.status === "APPROVED") as TemplateDefinition[];
  templateCache = { items, expiresAt: Date.now() + 5 * 60 * 1000 }; return items;
}

export function buildTemplateSnapshot(template: TemplateDefinition, parameters: string[]) {
  let cursor = 0;
  const lines: string[] = [];
  const components: Array<Record<string, unknown>> = [];
  const buttons = structuredClone(template.components.find((component) => component.type === "BUTTONS")?.buttons ?? []);
  const variableCount = (text = "") => [...text.matchAll(/\{\{(\d+)\}\}/g)].reduce((maximum, match) => Math.max(maximum, Number(match[1])), 0);
  const consume = (count: number) => {
    const values = parameters.slice(cursor, cursor + count);
    cursor += count;
    return values;
  };
  const render = (text: string, values: string[]) => text.replace(/\{\{(\d+)\}\}/g, (_match, index) => values[Number(index) - 1] ?? `{{${index}}}`);

  for (const component of template.components) {
    if (["HEADER", "BODY"].includes(component.type) && typeof component.text === "string") {
      const values = consume(variableCount(component.text));
      lines.push(render(component.text, values));
      if (values.length) components.push({ type: component.type.toLowerCase(), parameters: values.map((text) => ({ type: "text", text })) });
    } else if (component.type === "FOOTER" && typeof component.text === "string") {
      lines.push(component.text);
    } else if (component.type === "BUTTONS" && Array.isArray(component.buttons)) {
      component.buttons.forEach((button: Record<string, any>, index: number) => {
        if (button.type !== "URL" || typeof button.url !== "string") return;
        const count = variableCount(button.url);
        const values = consume(count);
        if (count) {
          components.push({ type: "button", sub_type: "url", index: String(index), parameters: values.map((text) => ({ type: "text", text })) });
          if (buttons[index]) buttons[index].url = render(button.url, values);
        }
      });
    }
  }
  if (parameters.length !== cursor) throw new Error(`O template ${template.name} exige ${cursor} parâmetro(s).`);
  return { text: lines.filter(Boolean).join("\n\n"), components, buttons, parameterCount: cursor };
}

export function resolveApprovedTemplate(templates: TemplateDefinition[], name: string, language: string) {
  const canonicalName = templateAliases[name] ?? name;
  return templates.find((item) => item.name === canonicalName && item.language === language);
}

export async function createIntegrationMessage(idempotencyKey: string, input: IntegrationMessageInput) {
  const organizationId = await defaultOrganizationId();
  const templates = await approvedTemplates();
  const definition = resolveApprovedTemplate(templates, input.template, input.language);
  if (!definition) throw new Error("Template não encontrado, não aprovado ou idioma incompatível.");
  const snapshot = buildTemplateSnapshot(definition, input.parameters);
  const templateName = definition.name;
  const scheduledFor = input.sendAt ?? new Date();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute<RowDataPacket[]>(`SELECT j.id, j.status, j.message_id AS messageId, j.conversation_id AS conversationId,
      j.scheduled_for AS scheduledFor, j.error_message AS errorMessage FROM integration_message_jobs j
      WHERE j.organization_id = ? AND j.idempotency_key = ? LIMIT 1`, [organizationId, idempotencyKey]);
    if (existing[0]) { await connection.commit(); return { ...existing[0], duplicate: true }; }
    const contactId = crypto.randomUUID();
    await connection.execute(`INSERT INTO contacts (id, organization_id, wa_id, phone, name)
      VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = COALESCE(name, VALUES(name)), phone = VALUES(phone)`,
      [contactId, organizationId, input.to, input.to, input.contactName ?? null]);
    const [contacts] = await connection.execute<RowDataPacket[]>("SELECT id FROM contacts WHERE organization_id = ? AND wa_id = ? LIMIT 1", [organizationId, input.to]);
    const persistedContactId = String(contacts[0]!.id); const conversationId = crypto.randomUUID();
    await connection.execute(`INSERT IGNORE INTO conversations (id, organization_id, contact_id, first_response_due_at, resolution_due_at)
      SELECT ?, ?, ?, DATE_ADD(NOW(3), INTERVAL COALESCE(s.first_response_minutes, 15) MINUTE), DATE_ADD(NOW(3), INTERVAL COALESCE(s.resolution_minutes, 480) MINUTE)
      FROM organizations o LEFT JOIN sla_policies s ON s.organization_id = o.id WHERE o.id = ?`, [conversationId, organizationId, persistedContactId, organizationId]);
    const [conversations] = await connection.execute<RowDataPacket[]>("SELECT id FROM conversations WHERE organization_id = ? AND contact_id = ? LIMIT 1", [organizationId, persistedContactId]);
    const persistedConversationId = String(conversations[0]!.id); const messageId = crypto.randomUUID(); const jobId = crypto.randomUUID();
    const content = { template: templateName, requestedTemplate: input.template, language: input.language, parameters: input.parameters, components: snapshot.components, buttons: snapshot.buttons, origin: "integration", source: String(input.metadata?.source ?? "site"), externalId: input.externalId ?? null, metadata: input.metadata ?? null, scheduledFor: scheduledFor.toISOString() };
    await connection.execute(`INSERT INTO messages (id, organization_id, conversation_id, direction, type, text_body, content, status)
      VALUES (?, ?, ?, 'outbound', 'template', ?, ?, 'queued')`, [messageId, organizationId, persistedConversationId, snapshot.text, JSON.stringify(content)]);
    await connection.execute(`INSERT INTO integration_message_jobs
      (id, organization_id, conversation_id, message_id, idempotency_key, external_id, phone, template_name, language, parameters, metadata, scheduled_for)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [jobId, organizationId, persistedConversationId, messageId, idempotencyKey, input.externalId ?? null, input.to, templateName, input.language, JSON.stringify(input.parameters), input.metadata ? JSON.stringify(input.metadata) : null, scheduledFor]);
    await connection.execute("UPDATE conversations SET last_message_preview = ?, last_message_at = NOW(3) WHERE id = ?", [snapshot.text.slice(0, 500), persistedConversationId]);
    await connection.execute(`INSERT INTO audit_logs (organization_id, action, entity_type, entity_id, metadata) VALUES (?, 'integration.message.created', 'message', ?, ?)`, [organizationId, messageId, JSON.stringify({ idempotencyKey, template: templateName, requestedTemplate: input.template, externalId: input.externalId ?? null })]);
    await connection.commit(); publish(organizationId, { type: "message", direction: "outbound", conversationId: persistedConversationId }); void processJobs();
    return { id: jobId, status: scheduledFor.getTime() > Date.now() + 1000 ? "scheduled" : "queued", messageId, conversationId: persistedConversationId, scheduledFor, duplicate: false };
  } catch (error: any) {
    await connection.rollback();
    if (error?.code === "ER_DUP_ENTRY") {
      const [rows] = await pool.execute<RowDataPacket[]>("SELECT id, status, message_id AS messageId, conversation_id AS conversationId, scheduled_for AS scheduledFor, error_message AS errorMessage FROM integration_message_jobs WHERE organization_id = ? AND idempotency_key = ? LIMIT 1", [organizationId, idempotencyKey]);
      if (rows[0]) return { ...rows[0], duplicate: true };
    }
    throw error;
  } finally { connection.release(); }
}

export async function getIntegrationMessage(id: string) {
  const organizationId = await defaultOrganizationId();
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT j.id, j.status, j.external_id AS externalId, j.phone, j.template_name AS template,
    j.language, j.scheduled_for AS scheduledFor, j.attempts, j.error_message AS errorMessage, j.created_at AS createdAt,
    j.processed_at AS processedAt, j.message_id AS messageId, j.conversation_id AS conversationId, m.meta_message_id AS wamid,
    m.status AS deliveryStatus, m.sent_at AS sentAt, m.delivered_at AS deliveredAt, m.read_at AS readAt
    FROM integration_message_jobs j JOIN messages m ON m.id = j.message_id WHERE j.id = ? AND j.organization_id = ? LIMIT 1`, [id, organizationId]);
  return rows[0] ?? null;
}

export async function cancelIntegrationMessage(id: string) {
  const organizationId = await defaultOrganizationId();
  const [result] = await pool.execute<ResultSetHeader>(`UPDATE integration_message_jobs j JOIN messages m ON m.id = j.message_id
    SET j.status = 'cancelled', j.processed_at = NOW(3), m.status = 'failed', m.error_message = 'Agendamento cancelado.'
    WHERE j.id = ? AND j.organization_id = ? AND j.status = 'pending'`, [id, organizationId]);
  return result.affectedRows > 0;
}

let processing = false; let worker: NodeJS.Timeout | undefined;
async function processJobs() {
  if (processing) return; processing = true;
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(`SELECT j.id, j.organization_id AS organizationId, j.conversation_id AS conversationId,
      j.message_id AS messageId, j.phone, j.template_name AS templateName, j.language, j.parameters, j.attempts, m.content
      FROM integration_message_jobs j JOIN messages m ON m.id = j.message_id
      WHERE j.status = 'pending' AND j.scheduled_for <= NOW(3) ORDER BY j.scheduled_for LIMIT 20`);
    for (const job of rows) {
      const [claim] = await pool.execute<ResultSetHeader>("UPDATE integration_message_jobs SET status = 'processing', attempts = attempts + 1 WHERE id = ? AND status = 'pending'", [job.id]);
      if (!claim.affectedRows) continue;
      try {
        const parameters = typeof job.parameters === "string" ? JSON.parse(job.parameters) : job.parameters;
        const content = typeof job.content === "string" ? JSON.parse(job.content) : job.content;
        const components = Array.isArray(content?.components)
          ? content.components
          : parameters.length ? [{ type: "body", parameters: parameters.map((text: string) => ({ type: "text", text })) }] : [];
        const result = await sendTemplate(String(job.phone), String(job.templateName), String(job.language), components);
        await pool.execute("UPDATE messages SET meta_message_id = ?, status = 'sent', sent_at = NOW(3) WHERE id = ?", [result.messageId, job.messageId]);
        await pool.execute("UPDATE integration_message_jobs SET status = 'sent', processed_at = NOW(3), error_message = NULL WHERE id = ?", [job.id]);
        await pool.execute("UPDATE conversations SET last_message_at = NOW(3) WHERE id = ?", [job.conversationId]);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha no envio"; const attempt = Number(job.attempts) + 1;
        if (attempt < 3) await pool.execute("UPDATE integration_message_jobs SET status = 'pending', scheduled_for = DATE_ADD(NOW(3), INTERVAL 30 SECOND), error_message = ? WHERE id = ?", [message, job.id]);
        else {
          await pool.execute("UPDATE integration_message_jobs SET status = 'failed', processed_at = NOW(3), error_message = ? WHERE id = ?", [message, job.id]);
          await pool.execute("UPDATE messages SET status = 'failed', error_message = ? WHERE id = ?", [message, job.messageId]);
        }
      }
      publish(String(job.organizationId), { type: "message", direction: "outbound", conversationId: String(job.conversationId) });
    }
  } finally { processing = false; }
}

export function startIntegrationMessageWorker() { void processJobs(); worker = setInterval(() => void processJobs(), 5000); worker.unref(); }
