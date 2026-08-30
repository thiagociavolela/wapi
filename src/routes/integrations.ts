import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { cancelIntegrationMessage, createIntegrationMessage, getIntegrationMessage } from "../modules/integrations/service.js";

export const integrationRouter = Router();
function authorized(value: string) {
  if (!config.INTEGRATION_API_KEY || !value.startsWith("Bearer ")) return false;
  const supplied = crypto.createHash("sha256").update(value.slice(7)).digest(); const expected = crypto.createHash("sha256").update(config.INTEGRATION_API_KEY).digest();
  return crypto.timingSafeEqual(supplied, expected);
}
integrationRouter.use((req, res, next) => {
  if (!config.INTEGRATION_API_KEY) return res.status(503).json({ error: "Integração transacional não configurada." });
  if (!authorized(String(req.headers.authorization ?? ""))) return res.status(401).json({ error: "Credencial da integração inválida." });
  next();
});

const messageSchema = z.object({
  to: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().regex(/^\d{10,15}$/)),
  contactName: z.string().trim().min(2).max(160).optional(), template: z.string().trim().regex(/^[a-z0-9_]{1,512}$/),
  language: z.string().trim().min(2).max(20).default("pt_BR"), parameters: z.array(z.union([z.string(), z.number()]).transform(String)).max(20).default([]),
  sendAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)).optional(), externalId: z.string().trim().min(1).max(190).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});
integrationRouter.post("/messages", async (req, res) => {
  const key = String(req.headers["idempotency-key"] ?? "");
  if (key.length < 8 || key.length > 190) return res.status(400).json({ error: "Envie um Idempotency-Key único de 8 a 190 caracteres." });
  const parsed = messageSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Payload transacional inválido.", details: parsed.error.flatten() });
  if (parsed.data.sendAt && parsed.data.sendAt.getTime() > Date.now() + 366 * 86400000) return res.status(400).json({ error: "O agendamento não pode ultrapassar um ano." });
  try { const result = await createIntegrationMessage(key, parsed.data); res.status(result.duplicate ? 200 : 202).json(result); }
  catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Não foi possível registrar a mensagem." }); }
});
integrationRouter.get("/messages/:id", async (req, res) => { const item = await getIntegrationMessage(String(req.params.id)); if (!item) return res.status(404).json({ error: "Mensagem não encontrada." }); res.json(item); });
integrationRouter.delete("/messages/:id", async (req, res) => { const ok = await cancelIntegrationMessage(String(req.params.id)); if (!ok) return res.status(409).json({ error: "A mensagem já foi processada ou cancelada." }); res.status(204).end(); });
