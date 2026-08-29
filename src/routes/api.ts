import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth } from "../modules/auth/auth.js";
import { addNote, assignConversation, changeStatus, countConversations, getMessageMedia, getMessages, listConversations, listNotes, listQuickReplies, listTags, listUsers, markConversationRead, openConversationForAgent, reactToMessage, replaceTags, retryAgentMedia, sendAgentMedia, sendAgentTemplate, sendAgentText, signalAgentTyping, updateContactName, updateConversationRouting } from "../modules/conversations/service.js";
import { convertVoiceToOgg } from "../modules/conversations/audio.js";
import { subscribe } from "../modules/realtime/events.js";
import { isMetaConfigured } from "../config.js";
import { listMessageTemplates } from "../modules/meta/client.js";
import { createTeam, createUser, getDashboard, getSlaPolicy, listManagedUsers, listTeams, updateSlaPolicy, updateTeam, updateUser } from "../modules/management/service.js";

export const apiRouter = Router();
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, /^(image|audio|video)\//.test(file.mimetype) || ["application/pdf", "text/plain", "application/zip"].includes(file.mimetype))
});
apiRouter.use(requireAuth);

apiRouter.get("/status", (_req, res) => res.json({ ok: true, metaConfigured: isMetaConfigured() }));
apiRouter.get("/conversations", async (req, res) => {
  const status = z.enum(["new", "open", "pending", "resolved"]).optional().catch(undefined).parse(req.query.status || undefined);
  const search = String(req.query.search ?? "");
  const [items, counts] = await Promise.all([listConversations(req.auth!.organizationId, search, status), countConversations(req.auth!.organizationId, search)]);
  res.json({ items, counts });
});
apiRouter.get("/conversations/:id/messages", async (req, res) => res.json(await getMessages(req.auth!.organizationId, String(req.params.id), req.query.before ? String(req.query.before) : undefined)));
apiRouter.post("/conversations/:id/read", async (req, res) => res.json({ ok: await markConversationRead(req.auth!.organizationId, String(req.params.id)) }));
apiRouter.get("/users", async (req, res) => res.json({ items: await listUsers(req.auth!.organizationId) }));
apiRouter.get("/quick-replies", async (req, res) => res.json({ items: await listQuickReplies(req.auth!.organizationId) }));
apiRouter.get("/templates", async (_req, res) => {
  try {
    const result = await listMessageTemplates();
    res.json({ items: result.data.filter((item) => item.status === "APPROVED") });
  } catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : "Falha ao listar templates." }); }
});
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
apiRouter.post("/conversations/:id/open", async (req, res) => {
  try { res.json(await openConversationForAgent(req.auth!.organizationId, req.auth!.id, String(req.params.id))); }
  catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : "Não foi possível abrir a conversa." }); }
});
apiRouter.patch("/conversations/:id/routing", async (req, res) => {
  const parsed = z.object({ teamId: z.string().uuid().nullable().optional(), priority: z.enum(["low", "normal", "high", "urgent"]).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Equipe ou prioridade inválida." });
  res.json({ ok: await updateConversationRouting(req.auth!.organizationId, req.auth!.id, String(req.params.id), parsed.data) });
});
apiRouter.post("/conversations/:id/messages", async (req, res) => {
  const parsed = z.object({ text: z.string().trim().min(1).max(4096), clientId: z.string().uuid().optional(), replyToMessageId: z.string().uuid().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A mensagem precisa ter entre 1 e 4096 caracteres." });
  try {
    res.status(201).json(await sendAgentText(req.auth!.organizationId, req.auth!.id, String(req.params.id), parsed.data.text, parsed.data.clientId, parsed.data.replyToMessageId));
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : "Falha ao enviar mensagem." });
  }
});
apiRouter.post("/conversations/:id/typing", async (req, res) => {
  try { res.json(await signalAgentTyping(req.auth!.organizationId, String(req.params.id))); }
  catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Falha ao sinalizar digitação." }); }
});
apiRouter.post("/conversations/:id/messages/:messageId/reaction", async (req, res) => {
  const parsed = z.object({ emoji: z.string().max(32) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Reação inválida." });
  try { res.json(await reactToMessage(req.auth!.organizationId, req.auth!.id, String(req.params.id), String(req.params.messageId), parsed.data.emoji)); }
  catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Falha ao reagir." }); }
});
apiRouter.post("/conversations/:id/media", mediaUpload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Selecione um arquivo válido de até 20 MB." });
  const caption = typeof req.body.caption === "string" ? req.body.caption.trim().slice(0, 1024) : undefined;
  try {
    res.status(201).json(await sendAgentMedia(req.auth!.organizationId, req.auth!.id, String(req.params.id), {
      buffer: req.file.buffer, mimeType: req.file.mimetype, fileName: req.file.originalname, caption
    }));
  } catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Falha ao enviar mídia." }); }
});
apiRouter.post("/conversations/:id/voice", mediaUpload.single("file"), async (req, res) => {
  if (!req.file || !req.file.mimetype.startsWith("audio/")) return res.status(400).json({ error: "Gravação de áudio inválida." });
  try {
    const buffer = await convertVoiceToOgg(req.file.buffer);
    if (buffer.length > 16 * 1024 * 1024) return res.status(413).json({ error: "O áudio convertido excede 16 MB." });
    res.status(201).json(await sendAgentMedia(req.auth!.organizationId, req.auth!.id, String(req.params.id), { buffer, mimeType: "audio/ogg", fileName: "gravacao.ogg" }));
  } catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Falha ao enviar áudio." }); }
});
apiRouter.post("/conversations/:id/messages/:messageId/retry-media", async (req, res) => {
  try { res.json(await retryAgentMedia(req.auth!.organizationId, req.auth!.id, String(req.params.id), String(req.params.messageId))); }
  catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Falha ao reenviar mídia." }); }
});
apiRouter.get("/messages/:id/media", async (req, res) => {
  try {
    const media = await getMessageMedia(req.auth!.organizationId, String(req.params.id));
    res.set({ "Content-Type": media.mimeType, "Cache-Control": "private, max-age=300", "Content-Length": String(media.buffer.length) });
    res.send(media.buffer);
  } catch (error) { res.status(404).json({ error: error instanceof Error ? error.message : "Mídia não encontrada." }); }
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
apiRouter.get("/management/dashboard", async (req, res) => res.json(await getDashboard(req.auth!.organizationId)));
apiRouter.get("/management/users", requireManager, async (req, res) => res.json({ items: await listManagedUsers(req.auth!.organizationId) }));
apiRouter.post("/management/users", requireManager, async (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(160), email: z.string().email(), password: z.string().min(10).max(200), role: z.enum(["admin", "supervisor", "agent"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dados do usuário inválidos." });
  res.status(201).json(await createUser(req.auth!.organizationId, parsed.data));
});
apiRouter.patch("/management/users/:id", requireManager, async (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(160).optional(), password: z.string().min(10).max(200).optional(), role: z.enum(["admin", "supervisor", "agent"]).optional(), active: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dados do usuário inválidos." });
  if (String(req.params.id) === req.auth!.id && parsed.data.active === false) return res.status(400).json({ error: "Você não pode desativar seu próprio usuário." });
  res.json({ ok: await updateUser(req.auth!.organizationId, String(req.params.id), parsed.data) });
});
apiRouter.get("/management/teams", async (req, res) => res.json({ items: await listTeams(req.auth!.organizationId) }));
apiRouter.post("/management/teams", requireManager, async (req, res) => {
  const parsed = teamSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Dados da equipe inválidos." });
  res.status(201).json(await createTeam(req.auth!.organizationId, parsed.data));
});
apiRouter.put("/management/teams/:id", requireManager, async (req, res) => {
  const parsed = teamSchema.extend({ active: z.boolean() }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Dados da equipe inválidos." });
  res.json({ ok: await updateTeam(req.auth!.organizationId, String(req.params.id), parsed.data) });
});
apiRouter.get("/management/sla", async (req, res) => res.json(await getSlaPolicy(req.auth!.organizationId)));
apiRouter.put("/management/sla", requireManager, async (req, res) => {
  const parsed = z.object({ firstResponseMinutes: z.number().int().min(1).max(10080), resolutionMinutes: z.number().int().min(1).max(43200) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Política de SLA inválida." });
  await updateSlaPolicy(req.auth!.organizationId, parsed.data.firstResponseMinutes, parsed.data.resolutionMinutes); res.json({ ok: true });
});
apiRouter.get("/events", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: "ready" })}\n\n`);
  const unsubscribe = subscribe(req.auth!.organizationId, res);
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
});

const teamSchema = z.object({ name: z.string().trim().min(2).max(100), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), memberIds: z.array(z.string().uuid()).max(100) });
function requireManager(req: any, res: any, next: any) {
  if (!req.auth || !["admin", "supervisor"].includes(req.auth.role)) return res.status(403).json({ error: "Permissão insuficiente." });
  next();
}
