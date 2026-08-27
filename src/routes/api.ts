import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../modules/auth/auth.js";
import { assignConversation, changeStatus, getMessages, listConversations, markConversationRead, sendAgentText } from "../modules/conversations/service.js";
import { subscribe } from "../modules/realtime/events.js";
import { isMetaConfigured } from "../config.js";

export const apiRouter = Router();
apiRouter.use(requireAuth);

apiRouter.get("/status", (_req, res) => res.json({ ok: true, metaConfigured: isMetaConfigured() }));
apiRouter.get("/conversations", async (req, res) => res.json({ items: await listConversations(req.auth!.organizationId, String(req.query.search ?? "")) }));
apiRouter.get("/conversations/:id/messages", async (req, res) => res.json(await getMessages(req.auth!.organizationId, String(req.params.id), req.query.before ? String(req.query.before) : undefined)));
apiRouter.post("/conversations/:id/read", async (req, res) => res.json({ ok: await markConversationRead(req.auth!.organizationId, String(req.params.id)) }));
apiRouter.post("/conversations/:id/assign", async (req, res) => res.json({ ok: await assignConversation(req.auth!.organizationId, String(req.params.id), req.body.userId === null ? null : req.auth!.id) }));
apiRouter.patch("/conversations/:id/status", async (req, res) => {
  const parsed = z.enum(["new", "open", "pending", "resolved"]).safeParse(req.body.status);
  if (!parsed.success) return res.status(400).json({ error: "Status inválido." });
  res.json({ ok: await changeStatus(req.auth!.organizationId, String(req.params.id), parsed.data) });
});
apiRouter.post("/conversations/:id/messages", async (req, res) => {
  const parsed = z.object({ text: z.string().trim().min(1).max(4096) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A mensagem precisa ter entre 1 e 4096 caracteres." });
  try {
    res.status(201).json(await sendAgentText(req.auth!.organizationId, req.auth!.id, String(req.params.id), parsed.data.text));
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : "Falha ao enviar mensagem." });
  }
});
apiRouter.get("/events", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: "ready" })}\n\n`);
  const unsubscribe = subscribe(req.auth!.organizationId, res);
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
});
