import type { RowDataPacket } from "mysql2";
import { pool } from "../../database/pool.js";

export interface DashboardFilters { search?: string; status?: string; from?: string; to?: string; page?: number }
const metrics = `COUNT(r.id) AS total,
  COALESCE(SUM(r.status IN ('sent','delivered','read')),0) AS sent,
  COALESCE(SUM(r.status IN ('delivered','read')),0) AS delivered,
  COALESCE(SUM(r.status='read'),0) AS readCount,
  COALESCE(SUM(r.status='failed'),0) AS failed,
  COALESCE(SUM(r.status IN ('pending','processing')),0) AS pending,
  COALESCE(SUM(r.status='cancelled'),0) AS cancelled`;
const fields = `c.id,c.name,c.description,c.template_name AS templateName,c.status,
  c.created_at AS createdAt,c.scheduled_for AS scheduledFor,c.started_at AS startedAt,
  c.completed_at AS completedAt,c.delay_seconds AS delaySeconds`;

export async function campaignDashboard(organizationId: string, filters: DashboardFilters) {
  const where = ['c.organization_id=?']; const values: string[] = [organizationId];
  if (filters.search) { where.push('(c.name LIKE ? OR c.template_name LIKE ?)'); values.push(`%${filters.search}%`, `%${filters.search}%`); }
  if (filters.status) { where.push('c.status=?'); values.push(filters.status); }
  if (filters.from) { where.push('c.created_at>=?'); values.push(`${filters.from} 00:00:00`); }
  if (filters.to) { where.push('c.created_at<DATE_ADD(?,INTERVAL 1 DAY)'); values.push(`${filters.to} 00:00:00`); }
  const clause = where.join(' AND ');
  const [count] = await pool.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM campaigns c WHERE ${clause}`, values);
  const total = Number(count[0]!.total); const pages = Math.max(1, Math.ceil(total / 20));
  const page = Math.min(filters.page || 1, pages);
  // Materialize the page before aggregating its recipients.
  const [items] = await pool.execute<RowDataPacket[]>(`SELECT ${fields},u.name AS createdByName,${metrics}
    FROM (SELECT * FROM campaigns c WHERE ${clause} ORDER BY c.created_at DESC,c.id DESC LIMIT 20 OFFSET ${(page-1)*20}) c
    LEFT JOIN users u ON u.id=c.created_by_user_id LEFT JOIN campaign_recipients r ON r.campaign_id=c.id
    GROUP BY c.id ORDER BY c.created_at DESC,c.id DESC`, values);
  const [summary] = await pool.execute<RowDataPacket[]>(`SELECT ${metrics},COUNT(DISTINCT c.id) AS campaigns
    FROM campaigns c LEFT JOIN campaign_recipients r ON r.campaign_id=c.id WHERE ${clause}`, values);
  const [active] = await pool.execute<RowDataPacket[]>(`SELECT ${fields},${metrics} FROM campaigns c
    LEFT JOIN campaign_recipients r ON r.campaign_id=c.id
    WHERE c.organization_id=? AND c.status IN ('scheduled','running','paused')
    GROUP BY c.id ORDER BY c.created_at DESC,c.id DESC LIMIT 10`, [organizationId]);
  return { items, summary: summary[0], active, total, page, pages };
}

export async function campaignReport(organizationId: string, id: string, filters: { search?: string; status?: string; page?: number }) {
  const [campaigns] = await pool.execute<RowDataPacket[]>(`SELECT ${fields},c.template_language AS templateLanguage,
    c.template_preview AS templatePreview,c.template_components AS templateComponents,u.name AS createdByName,${metrics}
    FROM campaigns c LEFT JOIN users u ON u.id=c.created_by_user_id LEFT JOIN campaign_recipients r ON r.campaign_id=c.id
    WHERE c.organization_id=? AND c.id=? GROUP BY c.id`, [organizationId,id]);
  if (!campaigns.length) return null;
  const where = ['organization_id=?','campaign_id=?']; const values: string[] = [organizationId,id];
  if (filters.search) { where.push('(name LIKE ? OR phone LIKE ?)'); values.push(`%${filters.search}%`,`%${filters.search}%`); }
  if (filters.status) { where.push(filters.status === 'delivered' ? "status IN ('delivered','read')" : 'status=?'); if (filters.status !== 'delivered') values.push(filters.status); }
  const clause=where.join(' AND ');
  const [count]=await pool.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM campaign_recipients WHERE ${clause}`,values);
  const total=Number(count[0]!.total); const pages=Math.max(1,Math.ceil(total/50)); const page=Math.min(filters.page||1,pages);
  const [recipients]=await pool.execute<RowDataPacket[]>(`SELECT id,name,phone,status,error_message AS errorMessage,sent_at AS sentAt,
    delivered_at AS deliveredAt,read_at AS readAt FROM campaign_recipients WHERE ${clause}
    ORDER BY created_at,id LIMIT 50 OFFSET ${(page-1)*50}`,values);
  const [errors]=await pool.execute<RowDataPacket[]>(`SELECT COALESCE(error_message,'Motivo não informado') AS reason,COUNT(*) AS total
    FROM campaign_recipients WHERE organization_id=? AND campaign_id=? AND status='failed'
    GROUP BY error_message ORDER BY total DESC LIMIT 20`,[organizationId,id]);
  return { ...campaigns[0],recipients,errors,recipientTotal:total,page,pages };
}

export async function campaignExport(organizationId: string, id: string, failedOnly=false) {
  const [rows]=await pool.execute<RowDataPacket[]>(`SELECT r.name,r.phone,r.status,r.error_message AS errorMessage,
    r.sent_at AS sentAt,r.delivered_at AS deliveredAt,r.read_at AS readAt
    FROM campaign_recipients r JOIN campaigns c ON c.id=r.campaign_id
    WHERE c.organization_id=? AND r.organization_id=? AND c.id=? ${failedOnly ? "AND r.status='failed'" : ''}
    ORDER BY r.created_at,r.id`,[organizationId,organizationId,id]);
  return rows;
}

export function csvCell(value: unknown) {
  let text=value instanceof Date ? value.toISOString() : String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text)) text="'"+text;
  return `"${text.replaceAll('"','""')}"`;
}
