import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../modules/auth/auth.js";
import { addNote, assignConversation, changeStatus, getMessages, listConversations, listNotes, listQuickReplies, listTags, listUsers, markConversationRead, replaceTags, sendAgentTemplate, sendAgentText, updateContactName } from "../modules/conversations/service.js";
import { subscribe } from "../modules/realtime/events.js";
import { isMetaConfigured } from "../config.js";

export const apiRouter = Router();
apiRouter.use(requireAuth);

apiRouter.get("/status", (_req, res) => res.json({ ok: true, metaConfigured: isMetaConfigured() }));
apiRouter.get("/conversations", async (req, res) => res.json({ items: await listConversations(req.auth!.organizationId, String(req.query.search ?? "")) }));
apiRouter.get("/conversations/:id/messages", async (req, res) => res.json(await getMessages(req.auth!.organizationId, String(req.params.id), req.query.before ? String(req.query.before) : undefined)));
apiRouter.post("/conversations/:id/read", async (req, res) => res.json({ ok: await markConversationRead(req.auth!.organizationId, String(req.params.id)) }));
apiRouter.get("/users", async (req, res) => res.json({ items: await listUsers(req.auth!.organizationId) }));
apiRouter.get("/quick-replies", async (req, res) => res.json({ items: await listQuickReplies(req.auth!.organizationId) }));
apiRouter.post("/conversations/:id/assign", async (req, res) => {
  const parsed = z.object({ userId: z.string().uuid().nullable() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Atendente inválido." });
  res.json({ ok: await assignConversation(req.auth!.organizationId, String(req.params.id), parsed.data.userId, req.auth!.id) });
});
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
apiRouter.post("/conversations/:id/templates", async (req, res) => {
  const parsed = z.object({
    name: z.string().trim().min(1).max(512).regex(/^[a-z0-9_]+$/),
    language: z.string().trim().min(2).max(20).default("pt_BR"),
    components: z.array(z.unknown()).default([])
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Informe um template válido e seu idioma." });
  try {
    res.status(201).json(await sendAgentTemplate(req.auth!.organizationId, req.auth!.id, String(req.params.id), parsed.data.name, parsed.data.language, parsed.data.components));
  } catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Falha ao enviar template." }); }
});
apiRouter.patch("/conversations/:id/contact", async (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(160) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Nome inválido." });
  res.json({ ok: await updateContactName(req.auth!.organizationId, String(req.params.id), parsed.data.name) });
});
apiRouter.get("/conversations/:id/notes", async (req, res) => res.json({ items: await listNotes(req.auth!.organizationId, String(req.params.id)) }));
apiRouter.post("/conversations/:id/notes", async (req, res) => {
  const parsed = z.object({ body: z.string().trim().min(1).max(4000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A anotação está vazia ou é muito longa." });
  res.status(201).json(await addNote(req.auth!.organizationId, req.auth!.id, String(req.params.id), parsed.data.body));
});
apiRouter.get("/conversations/:id/tags", async (req, res) => res.json({ items: await listTags(req.auth!.organizationId, String(req.params.id)) }));
apiRouter.put("/conversations/:id/tags", async (req, res) => {
  const parsed = z.object({ names: z.array(z.string().trim().min(1).max(60).regex(/^[^,|]+$/)).max(12) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Etiquetas inválidas." });
  const names = [...new Set(parsed.data.names.map((name) => name.toLowerCase()))];
  res.json({ items: await replaceTags(req.auth!.organizationId, req.auth!.id, String(req.params.id), names) });
});
apiRouter.get("/events", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: "ready" })}\n\n`);
  const unsubscribe = subscribe(req.auth!.organizationId, res);
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
});
