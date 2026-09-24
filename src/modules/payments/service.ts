import crypto from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { config } from "../../config.js";
import { pool } from "../../database/pool.js";

type CreatePaymentLinkInput = { name: string; email?: string; description?: string; amount: string };

function requireMercadoPago() {
  if (!config.MERCADO_PAGO_ACCESS_TOKEN) throw new Error("O token do Mercado Pago ainda não foi configurado.");
}

export function normalizeChargeAmount(value: string) {
  let source = value.replace(/R\$/gi, "").replace(/[\s\u00a0]/g, "");
  if (!source || !/^\d+(?:[.,]\d+)*$/.test(source)) return null;
  const comma = source.lastIndexOf(","); const dot = source.lastIndexOf("."); const separator = Math.max(comma, dot);
  if (separator >= 0) {
    const decimalPlaces = source.length - separator - 1;
    source = decimalPlaces >= 1 && decimalPlaces <= 2 ? `${source.slice(0, separator).replace(/\D/g, "")}.${source.slice(separator + 1)}` : source.replace(/\D/g, "");
  }
  const amount = Number(source);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null;
}

async function mercadoPagoFetch<T>(path: string, init: RequestInit = {}) {
  requireMercadoPago();
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${config.MERCADO_PAGO_ACCESS_TOKEN}`, "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(15000)
  });
  const payload = await response.json().catch(() => ({})) as T & { message?: string; error?: string };
  if (!response.ok) throw new Error(payload.message || payload.error || `Falha do Mercado Pago (${response.status}).`);
  return payload;
}

export async function createPaymentLink(organizationId: string, userId: string, conversationId: string, input: CreatePaymentLinkInput) {
  const amount = normalizeChargeAmount(input.amount); if (!amount) throw new Error("Informe um valor de cobrança válido.");
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT c.contact_id AS contactId, ct.phone, ct.wa_id AS waId
    FROM conversations c JOIN contacts ct ON ct.id = c.contact_id WHERE c.id = ? AND c.organization_id = ? LIMIT 1`, [conversationId, organizationId]);
  const conversation = rows[0]; if (!conversation) throw new Error("Conversa não encontrada.");
  const id = crypto.randomUUID(); const externalReference = crypto.randomUUID();
  await pool.execute(`INSERT INTO payment_links
    (id, organization_id, conversation_id, contact_id, created_by_user_id, customer_name, customer_email, customer_phone, description, amount, external_reference)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, organizationId, conversationId, conversation.contactId, userId, input.name, input.email || null, conversation.phone || conversation.waId || null, input.description || null, amount, externalReference]);
  try {
    const returnUrl = config.APP_URL.replace(/\/$/, "");
    const preference = await mercadoPagoFetch<{ id: string; init_point: string }>("/checkout/preferences", {
      method: "POST",
      body: JSON.stringify({
        items: [{ id, title: input.description || `Cobrança ${externalReference.slice(0, 8)}`, quantity: 1, currency_id: "BRL", unit_price: amount }],
        payer: { name: input.name, ...(input.email ? { email: input.email } : {}) },
        back_urls: {
          success: config.MERCADO_PAGO_SUCCESS_URL || `${returnUrl}/checkout/success`,
          failure: config.MERCADO_PAGO_FAILURE_URL || `${returnUrl}/checkout/failure`,
          pending: config.MERCADO_PAGO_PENDING_URL || `${returnUrl}/checkout/pending`
        },
        notification_url: `${returnUrl}/webhooks/mercado-pago`, auto_return: "approved", external_reference: externalReference
      })
    });
    await pool.execute("UPDATE payment_links SET status = 'pending', preference_id = ?, payment_url = ? WHERE id = ?", [preference.id, preference.init_point, id]);
    return { id, externalReference, preferenceId: preference.id, paymentUrl: preference.init_point, status: "pending", amount, description: input.description || null, createdAt: new Date().toISOString() };
  } catch (error) {
    await pool.execute("UPDATE payment_links SET status = 'error', error_message = ? WHERE id = ?", [error instanceof Error ? error.message : "Falha ao gerar link", id]);
    throw error;
  }
}

export async function listPaymentLinks(organizationId: string, conversationId: string) {
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT pl.id, pl.description, pl.amount, pl.status, pl.payment_id AS paymentId,
    pl.preference_id AS preferenceId, pl.payment_url AS paymentUrl, pl.external_reference AS externalReference,
    pl.created_at AS createdAt, pl.paid_at AS paidAt, u.name AS createdByName
    FROM payment_links pl JOIN users u ON u.id = pl.created_by_user_id
    WHERE pl.organization_id = ? AND pl.conversation_id = ? ORDER BY pl.created_at DESC LIMIT 20`, [organizationId, conversationId]);
  return rows;
}

export async function getPaymentLink(organizationId: string, id: string) {
  const [rows] = await pool.execute<RowDataPacket[]>("SELECT id, payment_url AS paymentUrl, amount, description, status FROM payment_links WHERE id = ? AND organization_id = ? LIMIT 1", [id, organizationId]);
  return rows[0] ?? null;
}

export async function processMercadoPagoPayment(paymentId: string) {
  const payment = await mercadoPagoFetch<{ id: number; status: string; external_reference?: string; date_approved?: string }>(`/v1/payments/${encodeURIComponent(paymentId)}`);
  if (!payment.external_reference) return false;
  const [result] = await pool.execute<any>(`UPDATE payment_links SET payment_id = ?, status = ?, paid_at = IF(? = 'approved', COALESCE(paid_at, ?), paid_at), error_message = NULL
    WHERE external_reference = ?`, [String(payment.id), payment.status, payment.status, payment.date_approved ? new Date(payment.date_approved) : new Date(), payment.external_reference]);
  return result.affectedRows > 0;
}

export function isValidMercadoPagoSignature(dataId: string, requestId: string, signature: string | undefined) {
  if (!config.MERCADO_PAGO_WEBHOOK_SECRET || !signature) return false;
  const parts = Object.fromEntries(signature.split(",").map((part) => part.trim().split("=", 2)));
  if (!parts.ts || !parts.v1) return false;
  const template = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
  const expected = crypto.createHmac("sha256", config.MERCADO_PAGO_WEBHOOK_SECRET).update(template).digest("hex");
  const received = Buffer.from(parts.v1, "hex"); const calculated = Buffer.from(expected, "hex");
  return received.length === calculated.length && crypto.timingSafeEqual(received, calculated);
}
