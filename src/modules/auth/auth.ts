import crypto from "node:crypto";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import type { RowDataPacket } from "mysql2";
import { config } from "../../config.js";
import { pool } from "../../database/pool.js";

export interface AuthUser {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  role: "admin" | "supervisor" | "agent";
}

interface UserRow extends RowDataPacket {
  id: string;
  organization_id: string;
  name: string;
  email: string;
  password_hash: string;
  role: AuthUser["role"];
}

const COOKIE = "service_desk_session";

export async function ensureInitialAdmin() {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM users");
  if (Number(rows[0]?.total) > 0) return;
  const organizationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const hash = await argon2.hash(config.ADMIN_PASSWORD, { type: argon2.argon2id });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("INSERT INTO organizations (id, name) VALUES (?, ?)", [organizationId, "Minha empresa"]);
    await connection.execute(
      "INSERT INTO users (id, organization_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, 'admin')",
      [userId, organizationId, "Administrador", config.ADMIN_EMAIL.toLowerCase(), hash]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function authenticate(email: string, password: string): Promise<AuthUser | null> {
  const [rows] = await pool.execute<UserRow[]>(
    "SELECT id, organization_id, name, email, password_hash, role FROM users WHERE email = ? AND active = TRUE LIMIT 1",
    [email.toLowerCase()]
  );
  const row = rows[0];
  if (!row || !(await argon2.verify(row.password_hash, password))) return null;
  return mapUser(row);
}

export function issueSession(res: Response, user: AuthUser) {
  const token = jwt.sign(user, config.JWT_SECRET, { expiresIn: "12h", issuer: "meta-service-desk" });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: "strict",
    maxAge: 12 * 60 * 60 * 1000,
    path: "/"
  });
}

export function clearSession(res: Response) {
  res.clearCookie(COOKIE, { path: "/" });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: "Não autenticado." });
  try {
    req.auth = jwt.verify(token, config.JWT_SECRET, { issuer: "meta-service-desk" }) as AuthUser;
    next();
  } catch {
    clearSession(res);
    res.status(401).json({ error: "Sessão inválida ou expirada." });
  }
}

function mapUser(row: UserRow): AuthUser {
  return { id: row.id, organizationId: row.organization_id, name: row.name, email: row.email, role: row.role };
}
