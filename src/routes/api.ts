import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth } from "../modules/auth/auth.js";
import { addNote, adminCanSendConversation, assignConversation, changeStatus, clearConversation, countConversations, createContact, createQuickReply, deleteConversationContact, getMessageMedia, getMessages, importContacts, listContacts, listConversations, listNotes, listQuickReplies, listTags, listUsers, markConversationRead, markConversationUnread, openConversationForAgent, reactToMessage, replaceTags, retryAgentMessage, sendAgentMedia, sendAgentTemplate, sendAgentText, signalAgentTyping, updateContactName, updateConversationRouting } from "../modules/conversations/service.js";
import { cancelScheduledMessage, createScheduledMessage, listScheduledMessages, updateScheduledMessage } from "../modules/conversations/scheduled.js";
import { convertVoiceToOgg } from "../modules/conversations/audio.js";
import { subscribe } from "../modules/realtime/events.js";
import { isMetaConfigured } from "../config.js";
import { listMessageTemplates } from "../modules/meta/client.js";
import { createTeam, createUser, getDashboard, getIntegrationDashboard, getSlaPolicy, listManagedUsers, listTeams, updateSlaPolicy, updateTeam, updateUser } from "../modules/management/service.js";
import { changeCampaignStatus, createCampaign, getCampaign, listCampaigns, parseCampaignContacts } from "../modules/campaigns/service.js";
import { buildCommerceTemplateComponents, buildTemplateSnapshot } from "../modules/integrations/service.js";
import { downloadProductImage, getProduct, productCaption, searchProducts } from "../modules/products/service.js";

export const apiRouter = Router();
const scheduledMessageSchema = z.discriminatedUnion("messageType", [
  z.object({ messageType: z.literal("text"), body: z.string().trim().min(1).max(4096), scheduledFor: z.coerce.date() }),
  z.object({ messageType: z.literal("template"), body: z.string().trim().min(1).max(4096), scheduledFor: z.coerce.date(),
    templateName: z.string().trim().min(1).max(512).regex(/^[a-z0-9_]+$/), templateLanguage: z.string().trim().min(2).max(20),
    templateComponents: z.array(z.unknown()).default([]) })
]);
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, /^(image|audio|video)\//.test(file.mimetype) || ["application/pdf", "text/plain", "text/csv", "application/zip", "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.presentationml.presentation"].includes(file.mimetype))
});
const contactListUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
apiRouter.use(requireAuth);
async function requireAdminAssignment(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) {
  if (!["admin", "supervisor"].includes(req.auth!.role) || await adminCanSendConversation(req.auth!.organizationId, req.auth!.id, String(req.params.id))) return next();
  res.status(403).json({ error: "Assuma a conversa antes de enviar mensagens." });
}

apiRouter.get("/status", (_req, res) => res.json({ ok: true, metaConfigured: isMetaConfigured() }));
apiRouter.get("/conversations", async (req, res) => {
  const status = z.enum(["new", "open", "pending", "resolved"]).optional().catch(undefined).parse(req.query.status || undefined);
  const mine = req.query.mine === "true";
  const search = String(req.query.search ?? "");
  const [items, counts] = await Promise.all([listConversations(req.auth!.organizationId, search, status, req.auth!.role !== "agent", mine ? req.auth!.id : undefined), countConversations(req.auth!.organizationId, search, req.auth!.id)]);
  res.json({ items, counts });
});
apiRouter.get("/contacts", async (req, res) => {
  const query = z.object({
    status: z.enum(["new", "open", "pending", "resolved"]).optional().catch(undefined),
    search: z.string().max(160).default("").catch(""),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(10).max(50).default(25)
  }).parse(req.query);
  res.json(await listContacts(req.auth!.organizationId, query.search, query.status, query.page, query.limit));
});
apiRouter.post("/contacts", async (req, res) => {
  const parsed = z.object({
    name: z.string().trim().min(2).max(160),
    countryCode: z.enum(["1", "33", "34", "39", "44", "49", "54", "55", "56", "57", "351", "595", "598"]).default("55"),
    phone: z.string().transform((value) => value.replace(/\D/g, "")).refine((value) => /^\d{8,12}$/.test(value))
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Informe um nome e um telefone com DDD e código do país." });
  const fullPhone = `${parsed.data.countryCode}${parsed.data.phone}`;
  if (fullPhone.length > 15) return res.status(400).json({ error: "O telefone informado é muito longo." });
  try { res.status(201).json(await createContact(req.auth!.organizationId, parsed.data.name, fullPhone)); }
  catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : "Não foi possível cadastrar o contato." }); }
});
apiRouter.post("/contacts/import", contactListUpload.single("file"), async (req, res) => {
  if (!req.file || !/\.csv$/i.test(req.file.originalname)) return res.status(400).json({ error: "Selecione um arquivo CSV de até 2 MB." });
  const parsed = parseCampaignContacts(req.file.buffer.toString("utf8"), req.file.originalname);
  if (parsed.items.length > 5000) return res.status(400).json({ error: "Cada arquivo pode conter até 5.000 contatos." });
  const contacts = parsed.items.filter((item): item is { phone: string; name: string } => Boolean(item.name?.trim()));
  const missingNames = parsed.items.length - contacts.length;
  if (!contacts.length) return res.status(400).json({ error: "O CSV deve conter as colunas nome e telefone." });
  const result = await importContacts(req.auth!.organizationId, contacts);
  res.status(201).json({ ...result, invalid: parsed.invalid.length + missingNames, duplicates: parsed.duplicates, total: parsed.items.length + parsed.invalid.length });
});
apiRouter.get("/conversations/:id/messages", async (req, res) => res.json(await getMessages(req.auth!.organizationId, String(req.params.id), req.query.before ? String(req.query.before) : undefined)));
apiRouter.post("/conversations/:id/read", async (req, res) => res.json({ ok: await markConversationRead(req.auth!.organizationId, String(req.params.id)) }));
apiRouter.post("/conversations/:id/unread", async (req, res) => res.json({ ok: await markConversationUnread(req.auth!.organizationId, String(req.params.id)) }));
apiRouter.delete("/conversations/:id/messages", async (req, res) => {
  if (req.auth!.role !== "admin") return res.status(403).json({ error: "Acesso exclusivo para administradores." });
  const ok = await clearConversation(req.auth!.organizationId, String(req.params.id), req.auth!.id);
  if (!ok) return res.status(404).json({ error: "Conversa não encontrada." });
  res.json({ ok: true });
});
apiRouter.delete("/conversations/:id/contact", async (req, res) => {
  if (req.auth!.role !== "admin") return res.status(403).json({ error: "Acesso exclusivo para administradores." });
  const ok = await deleteConversationContact(req.auth!.organizationId, String(req.params.id), req.auth!.id);
  if (!ok) return res.status(404).json({ error: "Contato não encontrado." });
  res.json({ ok: true });
});
apiRouter.get("/conversations/:id/scheduled", async (req, res) => res.json({ items: await listScheduledMessages(req.auth!.organizationId, String(req.params.id)) }));
apiRouter.post("/conversations/:id/scheduled", requireAdminAssignment, async (req, res) => {
  const parsed = scheduledMessageSchema.safeParse(req.body);
  if (!parsed.success || parsed.data.scheduledFor.getTime() < Date.now() + 30000) return res.status(400).json({ error: "Escolha uma data futura e informe a mensagem." });
  try { res.status(201).json(await createScheduledMessage(req.auth!.organizationId, req.auth!.id, String(req.params.id), parsed.data)); }
  catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Falha ao agendar mensagem." }); }
});
apiRouter.patch("/scheduled/:id", async (req, res) => {
  const parsed = scheduledMessageSchema.safeParse(req.body);
  if (!parsed.success || parsed.data.scheduledFor.getTime() < Date.now() + 30000) return res.status(400).json({ error: "Escolha uma data futura e informe a mensagem." });
  try { res.json(await updateScheduledMessage(req.auth!.organizationId, String(req.params.id), parsed.data)); }
  catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : "Não foi possível editar o agendamento." }); }
});
apiRouter.delete("/scheduled/:id", async (req, res) => {
  const ok = await cancelScheduledMessage(req.auth!.organizationId, String(req.params.id));
  if (!ok) return res.status(409).json({ error: "Este agendamento não pode mais ser cancelado." });
  res.json({ ok: true });
});
apiRouter.get("/users", async (req, res) => res.json({ items: await listUsers(req.auth!.organizationId, req.auth!.role) }));
apiRouter.get("/quick-replies", async (req, res) => res.json({ items: await listQuickReplies(req.auth!.organizationId, req.auth!.id) }));
apiRouter.post("/quick-replies", async (req, res) => {
  const parsed = z.object({ shortcut: z.string().trim().toLowerCase().regex(/^\/[a-z0-9_-]{2,39}$/), title: z.string().trim().min(2).max(100), body: z.string().trim().min(1).max(4096) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Informe título, mensagem e um atalho como /retorno." });
  try { res.status(201).json(await createQuickReply(req.auth!.organizationId, req.auth!.id, parsed.data)); }
  catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : "Não foi possível adicionar a mensagem rápida." }); }
});
apiRouter.get("/templates", async (_req, res) => {
  try {
    const result = await listMessageTemplates();
    res.json({ items: result.data.filter((item) => item.status === "APPROVED") });
  } catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : "Falha ao listar templates." }); }
});
apiRouter.get("/products", async (req, res) => {
  const parsed = z.string().trim().min(1).max(120).safeParse(req.query.search);
  if (!parsed.success) return res.json({ items: [] });
  try { res.json({ items: await searchProducts(parsed.data) }); }
  catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : "Falha ao pesquisar produtos." }); }
});
apiRouter.get("/products/:productId", async (req, res) => {
  const productId = z.coerce.number().int().positive().safeParse(req.params.productId);
  if (!productId.success) return res.status(400).json({ error: "Produto inválido." });
  try {
    const product = await getProduct(productId.data);
    if (!product) return res.status(404).json({ error: "Produto não encontrado." });
    res.json(product);
  } catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : "Falha ao carregar produto." }); }
});
apiRouter.post("/conversations/:id/products/:productId/send", requireAdminAssignment, async (req, res) => {
  const productId = z.coerce.number().int().positive().safeParse(req.params.productId);
  if (!productId.success) return res.status(400).json({ error: "Produto inválido." });
  try {
    const product = await getProduct(productId.data);
    if (!product) return res.status(404).json({ error: "Produto não encontrado." });
    const image = await downloadProductImage(product);
    res.status(201).json(await sendAgentMedia(req.auth!.organizationId, req.auth!.id, String(req.params.id), { ...image, caption: productCaption(product) }));
  } catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Falha ao enviar produto." }); }
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
apiRouter.post("/conversations/:id/messages", requireAdminAssignment, async (req, res) => {
  const parsed = z.object({ text: z.string().trim().min(1).max(4096), clientId: z.string().uuid().optional(), replyToMessageId: z.string().uuid().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A mensagem precisa ter entre 1 e 4096 caracteres." });
  try {
    res.status(201).json(await sendAgentText(req.auth!.organizationId, req.auth!.id, String(req.params.id), parsed.data.text, parsed.data.clientId, parsed.data.replyToMessageId));
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : "Falha ao enviar mensagem." });
  }
});
apiRouter.post("/conversations/:id/typing", requireAdminAssignment, async (req, res) => {
  try { res.json(await signalAgentTyping(req.auth!.organizationId, String(req.params.id))); }
  catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Falha ao sinalizar digitação." }); }
});
apiRouter.post("/conversations/:id/messages/:messageId/reaction", requireAdminAssignment, async (req, res) => {
  const parsed = z.object({ emoji: z.string().max(32) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Reação inválida." });
  try { res.json(await reactToMessage(req.auth!.organizationId, req.auth!.id, String(req.params.id), String(req.params.messageId), parsed.data.emoji)); }
  catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Falha ao reagir." }); }
});
apiRouter.post("/conversations/:id/media", requireAdminAssignment, mediaUpload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Selecione um arquivo válido de até 20 MB." });
  const caption = typeof req.body.caption === "string" ? req.body.caption.trim().slice(0, 1024) : undefined;
  try {
    res.status(201).json(await sendAgentMedia(req.auth!.organizationId, req.auth!.id, String(req.params.id), {
      buffer: req.file.buffer, mimeType: req.file.mimetype, fileName: req.file.originalname, caption
    }));
  } catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Falha ao enviar mídia." }); }
});
apiRouter.post("/conversations/:id/voice", requireAdminAssignment, mediaUpload.single("file"), async (req, res) => {
  if (!req.file || !req.file.mimetype.startsWith("audio/")) return res.status(400).json({ error: "Gravação de áudio inválida." });
  try {
    const buffer = await convertVoiceToOgg(req.file.buffer);
    if (buffer.length > 16 * 1024 * 1024) return res.status(413).json({ error: "O áudio convertido excede 16 MB." });
    res.status(201).json(await sendAgentMedia(req.auth!.organizationId, req.auth!.id, String(req.params.id), { buffer, mimeType: "audio/ogg", fileName: "gravacao.ogg" }));
  } catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Falha ao enviar áudio." }); }
});
apiRouter.post("/conversations/:id/messages/:messageId/retry", requireAdminAssignment, async (req, res) => {
  try { res.json(await retryAgentMessage(req.auth!.organizationId, req.auth!.id, String(req.params.id), String(req.params.messageId))); }
  catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Falha ao reenviar mensagem." }); }
});
apiRouter.get("/messages/:id/media", async (req, res) => {
  try {
    const media = await getMessageMedia(req.auth!.organizationId, String(req.params.id));
    res.set({ "Content-Type": media.mimeType, "Cache-Control": "private, max-age=300", "Content-Length": String(media.buffer.length) });
    res.send(media.buffer);
  } catch (error) { res.status(404).json({ error: error instanceof Error ? error.message : "Mídia não encontrada." }); }
});
apiRouter.post("/conversations/:id/templates", requireAdminAssignment, async (req, res) => {
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
apiRouter.get("/management/dashboard", requireManager, async (req, res) => res.json(await getDashboard(req.auth!.organizationId, req.auth!.role)));
apiRouter.get("/management/integrations", requireAdmin, async (req, res) => {
  const parsed = z.object({ search: z.string().max(160).optional().catch(undefined), status: z.enum(["pending", "processing", "sent", "failed", "cancelled"]).optional().catch(undefined), template: z.string().max(512).optional().catch(undefined), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(10).max(100).default(30) }).parse(req.query);
  res.json(await getIntegrationDashboard(req.auth!.organizationId, parsed));
});
apiRouter.get("/management/users", requireManager, async (req, res) => res.json({ items: await listManagedUsers(req.auth!.organizationId, req.auth!.role) }));
apiRouter.post("/management/users", requireManager, async (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(160), email: z.string().email(), password: z.string().min(10).max(200), role: z.enum(["admin", "supervisor", "agent"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dados do usuário inválidos." });
  if (req.auth!.role === "supervisor" && parsed.data.role === "admin") return res.status(403).json({ error: "Supervisor pode criar apenas atendentes e supervisores." });
  res.status(201).json(await createUser(req.auth!.organizationId, parsed.data));
});
apiRouter.patch("/management/users/:id", requireManager, async (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(160).optional(), email: z.string().trim().email().max(255).optional(), password: z.string().min(10).max(200).optional(), role: z.enum(["admin", "supervisor", "agent"]).optional(), active: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dados do usuário inválidos." });
  if (String(req.params.id) === req.auth!.id && parsed.data.active === false) return res.status(400).json({ error: "Você não pode desativar seu próprio usuário." });
  try { res.json({ ok: await updateUser(req.auth!.organizationId, String(req.params.id), parsed.data, req.auth!.role) }); }
  catch (error) { res.status(403).json({ error: error instanceof Error ? error.message : "Permissão insuficiente." }); }
});
apiRouter.get("/management/teams", async (req, res) => res.json({ items: await listTeams(req.auth!.organizationId) }));
apiRouter.post("/management/teams", requireManager, async (req, res) => {
  const parsed = teamSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Dados da equipe inválidos." });
  res.status(201).json(await createTeam(req.auth!.organizationId, parsed.data, req.auth!.role));
});
apiRouter.put("/management/teams/:id", requireManager, async (req, res) => {
  const parsed = teamSchema.extend({ active: z.boolean() }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Dados da equipe inválidos." });
  res.json({ ok: await updateTeam(req.auth!.organizationId, String(req.params.id), parsed.data, req.auth!.role) });
});
apiRouter.get("/management/sla", requireManager, async (req, res) => res.json(await getSlaPolicy(req.auth!.organizationId)));
apiRouter.put("/management/sla", requireManager, async (req, res) => {
  const parsed = z.object({ firstResponseMinutes: z.number().int().min(1).max(10080), resolutionMinutes: z.number().int().min(1).max(43200) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Política de SLA inválida." });
  await updateSlaPolicy(req.auth!.organizationId, parsed.data.firstResponseMinutes, parsed.data.resolutionMinutes); res.json({ ok: true });
});
apiRouter.get("/campaigns", requireManager, async (req, res) => res.json({ items: await listCampaigns(req.auth!.organizationId) }));
apiRouter.get("/campaigns/:id", requireManager, async (req, res) => {
  const item = await getCampaign(req.auth!.organizationId, String(req.params.id));
  if (!item) return res.status(404).json({ error: "Campanha não encontrada." });
  res.json(item);
});
apiRouter.post("/campaigns/import", requireManager, contactListUpload.single("file"), async (req, res) => {
  if (!req.file || !/\.(csv|txt)$/i.test(req.file.originalname)) return res.status(400).json({ error: "Envie um arquivo CSV ou TXT de até 2 MB." });
  res.json(parseCampaignContacts(req.file.buffer.toString("utf8"), req.file.originalname));
});
apiRouter.post(["/campaigns", "/campaigns/create"], requireManager, async (req, res) => {
  const parsed = z.object({
    name: z.string().trim().min(2).max(160), description: z.string().trim().max(500).optional(),
    templateName: z.string().trim().min(1).max(512), templateLanguage: z.string().trim().min(2).max(20),
    parameters: z.array(z.string().max(1024)).max(30).default([]), catalogProductIds: z.array(z.string().trim().min(1).max(128)).max(30).default([]),
    catalogSectionTitle: z.string().trim().min(1).max(24).default("Produtos"), delaySeconds: z.number().int().min(1).max(300),
    scheduledFor: z.coerce.date().optional(), recipients: z.array(z.object({ phone: z.string().max(32), name: z.string().max(160).optional() })).min(1).max(5000),
    saveContacts: z.boolean().default(false)
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Revise os dados, destinatários, template e intervalo da campanha." });
  try {
    const templates = (await listMessageTemplates()).data;
    const template = templates.find((item) => item.status === "APPROVED" && item.name === parsed.data.templateName && item.language === parsed.data.templateLanguage);
    if (!template) return res.status(422).json({ error: "Template não encontrado ou não aprovado pela Meta." });
    const snapshot = buildTemplateSnapshot(template as any, parsed.data.parameters);
    snapshot.components.push(...buildCommerceTemplateComponents(template as any, parsed.data.catalogProductIds, parsed.data.catalogSectionTitle));
    res.status(201).json(await createCampaign(req.auth!.organizationId, req.auth!.id, { ...parsed.data, templateComponents: snapshot.components, templatePreview: snapshot.text }));
  } catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Não foi possível criar a campanha." }); }
});
apiRouter.post("/campaigns/:id/:action", requireManager, async (req, res) => {
  const action = z.enum(["pause", "resume", "cancel"]).safeParse(req.params.action);
  if (!action.success) return res.status(400).json({ error: "Ação inválida." });
  const ok = await changeCampaignStatus(req.auth!.organizationId, String(req.params.id), action.data);
  if (!ok) return res.status(409).json({ error: "A campanha não permite esta ação agora." });
  res.json({ ok: true });
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
function requireAdmin(req: any, res: any, next: any) {
  if (!req.auth || req.auth.role !== "admin") return res.status(403).json({ error: "Acesso exclusivo para administradores." });
  next();
}
