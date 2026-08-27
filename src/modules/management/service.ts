import crypto from "node:crypto";
import argon2 from "argon2";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "../../database/pool.js";

export async function getDashboard(organizationId: string) {
  const [summary] = await pool.execute<RowDataPacket[]>(`SELECT
    COUNT(*) AS total,
    SUM(status = 'new') AS newCount,
    SUM(status = 'open') AS openCount,
    SUM(status = 'pending') AS pendingCount,
    SUM(status = 'resolved') AS resolvedCount,
    SUM(unread_count) AS unreadCount,
    SUM(first_response_at IS NULL AND first_response_due_at < NOW(3) AND status <> 'resolved') AS slaBreached,
    SUM(resolved_at IS NULL AND resolution_due_at < NOW(3) AND status <> 'resolved') AS resolutionSlaBreached,
    SUM(priority = 'urgent' AND status <> 'resolved') AS urgentCount,
    SUM(service_window_expires_at > NOW(3) AND status <> 'resolved') AS windowOpenCount,
    SUM(service_window_expires_at BETWEEN NOW(3) AND DATE_ADD(NOW(3), INTERVAL 2 HOUR) AND status <> 'resolved') AS windowExpiringCount,
    SUM((service_window_expires_at IS NULL OR service_window_expires_at <= NOW(3)) AND status <> 'resolved') AS windowExpiredCount,
    SUM(assigned_user_id IS NULL AND status <> 'resolved') AS unassignedCount,
    SUM(priority IN ('high', 'urgent') AND status <> 'resolved') AS highPriorityCount
    FROM conversations WHERE organization_id = ?`, [organizationId]);
  const [agents] = await pool.execute<RowDataPacket[]>(`SELECT u.id, u.name,
    COUNT(c.id) AS conversations,
    SUM(c.status = 'open') AS openCount,
    SUM(c.first_response_at IS NULL AND c.first_response_due_at < NOW(3) AND c.status <> 'resolved') AS slaBreached
    FROM users u LEFT JOIN conversations c ON c.assigned_user_id = u.id
    WHERE u.organization_id = ? AND u.active = TRUE GROUP BY u.id, u.name ORDER BY openCount DESC`, [organizationId]);
  const [teams] = await pool.execute<RowDataPacket[]>(`SELECT t.id, t.name, t.color, COUNT(c.id) AS conversations,
    SUM(c.status <> 'resolved') AS activeCount FROM teams t LEFT JOIN conversations c ON c.team_id = t.id
    WHERE t.organization_id = ? AND t.active = TRUE GROUP BY t.id, t.name, t.color ORDER BY t.name`, [organizationId]);
  const [response] = await pool.execute<RowDataPacket[]>(`SELECT ROUND(AVG(TIMESTAMPDIFF(SECOND, created_at, first_response_at))) AS averageFirstResponseSeconds
    FROM conversations WHERE organization_id = ? AND first_response_at IS NOT NULL`, [organizationId]);
  const [messageSummary] = await pool.execute<RowDataPacket[]>(`SELECT
    SUM(created_at >= CURDATE()) AS messagesToday,
    SUM(created_at >= CURDATE() AND direction = 'inbound') AS inboundToday,
    SUM(created_at >= CURDATE() AND direction = 'outbound') AS outboundToday,
    SUM(created_at >= DATE_SUB(NOW(3), INTERVAL 7 DAY)) AS messagesSevenDays
    FROM messages WHERE organization_id = ?`, [organizationId]);
  const [dailyMessages] = await pool.execute<RowDataPacket[]>(`SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day,
    SUM(direction = 'inbound') AS inbound, SUM(direction = 'outbound') AS outbound
    FROM messages WHERE organization_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
    GROUP BY DATE(created_at) ORDER BY day`, [organizationId]);
  const [priorities] = await pool.execute<RowDataPacket[]>(`SELECT priority, COUNT(*) AS total FROM conversations
    WHERE organization_id = ? AND status <> 'resolved' GROUP BY priority`, [organizationId]);
  const [recent] = await pool.execute<RowDataPacket[]>(`SELECT c.id, COALESCE(ct.name, ct.profile_name, ct.phone) AS contactName,
    ct.phone, c.status, c.priority, c.unread_count AS unreadCount, c.service_window_expires_at AS serviceWindowExpiresAt,
    c.last_message_at AS lastMessageAt, u.name AS assignedUserName
    FROM conversations c JOIN contacts ct ON ct.id = c.contact_id LEFT JOIN users u ON u.id = c.assigned_user_id
    WHERE c.organization_id = ? AND c.status <> 'resolved'
    ORDER BY (c.priority = 'urgent') DESC, c.unread_count DESC, c.last_message_at DESC LIMIT 8`, [organizationId]);
  return { summary: summary[0], agents, teams, messageSummary: messageSummary[0], dailyMessages, priorities, recent,
    averageFirstResponseSeconds: Number(response[0]?.averageFirstResponseSeconds ?? 0), generatedAt: new Date().toISOString() };
}

export async function listManagedUsers(organizationId: string) {
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT u.id, u.name, u.email, u.role, u.active, u.created_at AS createdAt,
    GROUP_CONCAT(t.name ORDER BY t.name SEPARATOR '||') AS teamNames
    FROM users u LEFT JOIN team_members tm ON tm.user_id = u.id LEFT JOIN teams t ON t.id = tm.team_id
    WHERE u.organization_id = ? GROUP BY u.id ORDER BY u.name`, [organizationId]);
  return rows;
}

export async function createUser(organizationId: string, input: { name: string; email: string; password: string; role: string }) {
  const id = crypto.randomUUID(); const hash = await argon2.hash(input.password, { type: argon2.argon2id });
  await pool.execute("INSERT INTO users (id, organization_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)",
    [id, organizationId, input.name, input.email.toLowerCase(), hash, input.role]);
  return { id };
}

export async function updateUser(organizationId: string, id: string, input: { name?: string; role?: string; active?: boolean; password?: string }) {
  const fields: string[] = []; const values: unknown[] = [];
  if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
  if (input.role !== undefined) { fields.push("role = ?"); values.push(input.role); }
  if (input.active !== undefined) { fields.push("active = ?"); values.push(input.active); }
  if (input.password) { fields.push("password_hash = ?"); values.push(await argon2.hash(input.password, { type: argon2.argon2id })); }
  if (!fields.length) return false; values.push(id, organizationId);
  const [result] = await pool.execute<ResultSetHeader>(`UPDATE users SET ${fields.join(", ")} WHERE id = ? AND organization_id = ?`, values as any[]);
  return result.affectedRows > 0;
}

export async function listTeams(organizationId: string) {
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT t.id, t.name, t.color, t.active, COUNT(tm.user_id) AS memberCount,
    GROUP_CONCAT(tm.user_id SEPARATOR '||') AS memberIds
    FROM teams t LEFT JOIN team_members tm ON tm.team_id = t.id WHERE t.organization_id = ? GROUP BY t.id ORDER BY t.name`, [organizationId]);
  return rows;
}

export async function createTeam(organizationId: string, input: { name: string; color: string; memberIds: string[] }) {
  const id = crypto.randomUUID();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("INSERT INTO teams (id, organization_id, name, color) VALUES (?, ?, ?, ?)", [id, organizationId, input.name, input.color]);
    for (const userId of input.memberIds) await connection.execute(`INSERT INTO team_members (team_id, user_id)
      SELECT ?, id FROM users WHERE id = ? AND organization_id = ?`, [id, userId, organizationId]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  return { id };
}

export async function updateTeam(organizationId: string, id: string, input: { name: string; color: string; active: boolean; memberIds: string[] }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute<ResultSetHeader>("UPDATE teams SET name = ?, color = ?, active = ? WHERE id = ? AND organization_id = ?", [input.name, input.color, input.active, id, organizationId]);
    if (!result.affectedRows) { await connection.rollback(); return false; }
    await connection.execute("DELETE FROM team_members WHERE team_id = ?", [id]);
    for (const userId of input.memberIds) await connection.execute(`INSERT INTO team_members (team_id, user_id)
      SELECT ?, id FROM users WHERE id = ? AND organization_id = ?`, [id, userId, organizationId]);
    await connection.commit(); return true;
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

export async function getSlaPolicy(organizationId: string) {
  const [rows] = await pool.execute<RowDataPacket[]>("SELECT first_response_minutes AS firstResponseMinutes, resolution_minutes AS resolutionMinutes FROM sla_policies WHERE organization_id = ?", [organizationId]);
  return rows[0] ?? { firstResponseMinutes: 15, resolutionMinutes: 480 };
}

export async function updateSlaPolicy(organizationId: string, firstResponseMinutes: number, resolutionMinutes: number) {
  await pool.execute(`INSERT INTO sla_policies (organization_id, first_response_minutes, resolution_minutes) VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE first_response_minutes = VALUES(first_response_minutes), resolution_minutes = VALUES(resolution_minutes)`,
    [organizationId, firstResponseMinutes, resolutionMinutes]);
}
