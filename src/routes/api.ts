import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth } from "../modules/auth/auth.js";
import { supervisorCanAccessResource, addNote, adminCanSendConversation, assignConversation, changeStatus, clearConversation, countConversations, createContact, createQuickReply, deleteConversationContact, getMessageMedia, getMessages, importContacts, listContacts, listConversations, listNotes, listQuickReplies, listTags, listUsers, markConversationRead, markConversationUnread, openConversationForAgent, reactToMessage, replaceTags, retryAgentMessage, sendAgentMedia, sendAgentTemplate, sendAgentText, signalAgentTyping, updateContactName, updateConversationRouting } from "../modules/conversations/service.js";
import { cancelScheduledMessage, createScheduledMessage, listScheduledMessages, updateScheduledMessage } from "../modules/conversations/scheduled.js";
import { convertVoiceToOgg } from "../modules/conversations/audio.js";
import { subscribe } from "../modules/realtime/events.js";
import { isMetaConfigured } from "../config.js";
import { listMessageTemplates, editMessageTemplate } from "../modules/meta/client.js";
import { editCarouselDefinition } from '../modules/campaigns/template-editor.js';
import { createTeam, createUser, getDashboard, getIntegrationDashboard, getSlaPolicy, listManagedUsers, listTeams, updateSlaPolicy, updateTeam, updateUser } from "../modules/management/service.js";
import { changeCampaignStatus, createCampaign, deleteCompletedCampaign, getCampaign, listCampaigns, parseCampaignContacts } from "../modules/campaigns/service.js";
import { campaignDashboard, campaignReport, campaignExport, csvCell } from "../modules/campaigns/dashboard.js";
import { buildCarouselComponents, CAROUSEL_TEMPLATE_NAME } from '../modules/campaigns/carousel.js';
import { carouselImagePath,storeCarouselImage } from '../modules/campaigns/carousel-media.js';
import { buildCommerceTemplateComponents, buildTemplateSnapshot } from "../modules/integrations/service.js";
import { downloadProductImage, getProduct, productCaption, productDescriptionMessages, searchProducts } from "../modules/products/service.js";
import { createPaymentLink, deletePaymentLink, getPaymentLink, listPaymentLinks } from "../modules/payments/service.js";

export const apiRouter = Router();
const carouselCardsSchema=z.array(z.object({mediaId:z.string().regex(/^\d+$/),parameters:z.array(z.string().trim().min(1).max(160)).max(10),url:z.string().url().max(2000),productId:z.string().max(64).optional(),title:z.string().max(80).optional()})).max(10).default([]);
async function requireCarouselAssetAccess(req: import('express').Request,res: import('express').Response,next: import('express').NextFunction) {
  if(!req.params.id)return requireManager(req,res,next);
  if(!await adminCanSendConversation(req.auth!.organizationId,req.auth!.id,String(req.params.id)))return res.status(403).json({error:'Assuma a conversa antes de preparar o carrossel.'});
  next();
}
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
apiRouter.use(async (req, res, next) => {
  if (req.auth!.role !== 'supervisor') return next();
  const match = /^\/(conversations|messages|scheduled)\/([^/]+)(?:\/|$)/.exec(req.path);
  if (!match) return next();
  const resource = match[1] === 'messages' ? 'message' : match[1] === 'scheduled' ? 'scheduled' : 'conversation';
  if (!await supervisorCanAccessResource(req.auth!.organizationId, decodeURIComponent(match[2]!), resource)) {
    res.status(403).json({ error: 'Você não tem acesso a esta conversa.' });
    return;
  }
  next();
});
async function requireAdminAssignment(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) {
  if (!["admin", "supervisor"].includes(req.auth!.role) || await adminCanSendConversation(req.auth!.organizationId, req.auth!.id, String(req.params.id))) return next();
  res.status(403).json({ error: "Assuma a conversa antes de enviar mensagens." });
}

apiRouter.get("/status", (_req, res) => res.json({ ok: true, metaConfigured: isMetaConfigured() }));
apiRouter.get("/conversations", async (req, res) => {
  const status = z.enum(["new", "open", "pending", "resolved"]).optional().catch(undefined).parse(req.query.status || undefined);
  const mine = req.query.mine === "true";
  const search = String(req.query.search ?? "");
  const { limit, offset, id, assignedUserId } = z.object({
    assignedUserId: z.string().uuid().optional(),
    id: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(10000).default(10),
    offset: z.coerce.number().int().min(0).max(10000000).default(0)
  }).parse(req.query);
  if (assignedUserId && req.auth!.role === 'agent') {
    res.status(403).json({ error: 'Filtro disponível somente para administradores e supervisores.' });
    return;
  }
  const [page, counts] = await Promise.all([listConversations(req.auth!.organizationId, search, status, mine ? req.auth!.id : status === "open" ? assignedUserId : undefined, limit, offset, id, req.auth!.role), offset === 0 ? countConversations(req.auth!.organizationId, search, req.auth!.id, req.auth!.role) : Promise.resolve(undefined)]);
  res.json({ ...page, counts });
});
apiRouter.get("/contacts", async (req, res) => {
  const query = z.object({
    status: z.enum(["new", "open", "pending", "resolved"]).optional().catch(undefined),
    search: z.string().max(160).default("").catch(""),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(10).max(50).default(25)
  }).parse(req.query);
  res.json(await listContacts(req.auth!.organizationId, query.search, query.status, query.page, query.limit, req.auth!.role));
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
  try { res.json({ items: await searchProducts(parsed.data,req.query.active==='true') }); }
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
  const options = z.object({ includeDescription: z.boolean().default(true) }).safeParse(req.body ?? {});
  if (!options.success) return res.status(400).json({ error: "Opções de envio inválidas." });
  try {
    const product = await getProduct(productId.data);
    if (!product) return res.status(404).json({ error: "Produto não encontrado." });
    const image = await downloadProductImage(product);
    const media = await sendAgentMedia(req.auth!.organizationId, req.auth!.id, String(req.params.id), { ...image, caption: productCaption(product, false) });
    const descriptions = [];
    if (options.data.includeDescription) {
      for (const text of productDescriptionMessages(product)) descriptions.push(await sendAgentText(req.auth!.organizationId, req.auth!.id, String(req.params.id), text));
    }
    res.status(201).json({ ...media, descriptions });
  } catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Falha ao enviar produto." }); }
});
apiRouter.get("/conversations/:id/payment-links", async (req, res) => {
  try { res.json({ items: await listPaymentLinks(req.auth!.organizationId, String(req.params.id)) }); }
  catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Falha ao listar cobranças." }); }
});
apiRouter.post("/conversations/:id/payment-links", requireAdminAssignment, async (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(160), email: z.union([z.string().trim().email().max(190), z.literal("")]).optional(), description: z.string().trim().max(500).optional(), amount: z.string().trim().min(1).max(40) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Revise nome, e-mail, descrição e valor da cobrança." });
  try { res.status(201).json(await createPaymentLink(req.auth!.organizationId, req.auth!.id, String(req.params.id), parsed.data)); }
  catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Falha ao gerar link de pagamento." }); }
});
apiRouter.post("/conversations/:id/payment-links/:paymentLinkId/send", requireAdminAssignment, async (req, res) => {
  try {
    const link = await getPaymentLink(req.auth!.organizationId, String(req.params.paymentLinkId));
    if (!link?.paymentUrl) return res.status(404).json({ error: "Link de pagamento não encontrado." });
    const amount = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(link.amount));
    const text = [`*Link de pagamento*`, link.description ? String(link.description) : "Cobrança", `Valor: *${amount}*`, String(link.paymentUrl)].join("\n\n");
    res.status(201).json(await sendAgentText(req.auth!.organizationId, req.auth!.id, String(req.params.id), text));
  } catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Falha ao enviar link de pagamento." }); }
});
apiRouter.delete("/conversations/:id/payment-links/:paymentLinkId", requireAdminAssignment, async (req, res) => {
  try {
    const ok = await deletePaymentLink(req.auth!.organizationId, String(req.params.paymentLinkId));
    if (!ok) return res.status(404).json({ error: "Link de pagamento não encontrado." });
    res.json({ ok: true });
  } catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Falha ao excluir link de pagamento." }); }
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
    components: z.array(z.unknown()).default([]),carouselCards:carouselCardsSchema
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Informe um template válido e seu idioma." });
  try {
    let components=parsed.data.components;let preview: string|undefined;
    if(parsed.data.carouselCards.length||parsed.data.name===CAROUSEL_TEMPLATE_NAME||components.some((component:any)=>component?.type?.toLowerCase()==='carousel')){
      if(!await adminCanSendConversation(req.auth!.organizationId,req.auth!.id,String(req.params.id)))return res.status(403).json({error:'Assuma a conversa antes de enviar o carrossel.'});
      const template=(await listMessageTemplates()).data.find(item=>item.name===parsed.data.name&&item.language===parsed.data.language&&item.status==='APPROVED');
      if(!template)return res.status(422).json({error:'O modelo de carrossel não está aprovado ou disponível.'});
      for(const card of parsed.data.carouselCards)await carouselImagePath(req.auth!.organizationId,card.mediaId);
      components=[...components.filter((component:any)=>component?.type?.toLowerCase()!=='carousel'),...buildCarouselComponents(template as any,parsed.data.carouselCards)];
      const body=String(template.components?.find((component:any)=>component.type==='BODY')?.text||'');
      const parameters=(components.find((component:any)=>component?.type==='body') as any)?.parameters||[];
      preview=body.replace(/\{\{(\d+|[a-z_][a-z0-9_]*)\}\}/g,(_:string,name:string)=>parameters[/^\d+$/.test(name)?Number(name)-1:parameters.findIndex((parameter:any)=>parameter.parameter_name===name)]?.text||'');
    }
    res.status(201).json(await sendAgentTemplate(req.auth!.organizationId, req.auth!.id, String(req.params.id), parsed.data.name, parsed.data.language, components,preview));
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
apiRouter.get('/campaigns/carousel/template', requireManager, async (_req,res)=>{
  try {
    const template=(await listMessageTemplates()).data.find(item=>item.name===CAROUSEL_TEMPLATE_NAME);
    res.json({name:CAROUSEL_TEMPLATE_NAME,status:template?.status||'NOT_CREATED'});
  } catch(error){res.status(502).json({error:error instanceof Error?error.message:'Não foi possível consultar o modelo.'});}
});
apiRouter.get('/campaigns/carousel/template/edit', requireAdmin, async (_req,res)=>{
  try {
    const template=(await listMessageTemplates()).data.find(item=>item.name===CAROUSEL_TEMPLATE_NAME&&item.language==='pt_BR');
    if(!template)return res.status(404).json({error:'Modelo de carrossel não encontrado.'});
    res.json({template});
  }catch(error){res.status(502).json({error:error instanceof Error?error.message:'Não foi possível consultar o modelo.'});}
});
apiRouter.post('/campaigns/carousel/template/edit', requireAdmin, async (req,res)=>{
  const parsed=z.object({body:z.string().trim().min(1).max(1024),cardBodies:z.array(z.string().trim().min(1).max(160)).min(2).max(10),urlLabel:z.string().trim().min(1).max(25),replyLabel:z.string().trim().min(1).max(25)}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'Preencha os textos e os botões dentro dos limites indicados.'});
  try {
    const template=(await listMessageTemplates()).data.find(item=>item.name===CAROUSEL_TEMPLATE_NAME&&item.language==='pt_BR');
    if(!template)return res.status(404).json({error:'Modelo não encontrado.'});
    if(!['APPROVED','REJECTED'].includes(template.status))return res.status(409).json({error:'Aguarde a análise atual da Meta antes de editar novamente.'});
    const components=editCarouselDefinition(template.components,parsed.data);
    const result=await editMessageTemplate(template.id,components);
    if(!result.success)throw new Error('A Meta não confirmou a alteração. Atualize os modelos para consultar o estado.');
    res.json({status:'PENDING',message:'Alterações enviadas para análise da Meta.'});
  }catch(error){res.status(422).json({error:error instanceof Error?error.message:'Não foi possível enviar para aprovação.'});}
});
apiRouter.post(['/campaigns/carousel/media','/conversations/:id/carousel/media'], requireCarouselAssetAccess, mediaUpload.single('file'), async (req,res)=>{
  if(!req.file||!req.file.mimetype.startsWith('image/'))return res.status(400).json({error:'Selecione uma imagem.'});
  try{res.json(await storeCarouselImage(req.auth!.organizationId,req.file.buffer));}
  catch(error){res.status(422).json({error:error instanceof Error?error.message:'Não foi possível enviar a imagem.'});}
});
apiRouter.post(['/campaigns/carousel/product-media','/conversations/:id/carousel/product-media'], requireCarouselAssetAccess, async (req,res)=>{
  const parsed=z.object({productId:z.coerce.number().int().positive()}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'Produto inválido.'});
  try{
    const product=await getProduct(parsed.data.productId);
    if(!product||!product.active)return res.status(404).json({error:'Produto não encontrado ou inativo.'});
    const image=await downloadProductImage(product,true);
    res.json({...await storeCarouselImage(req.auth!.organizationId,image.buffer,true),product});
  }catch(error){res.status(422).json({error:error instanceof Error?error.message:'Não foi possível preparar o produto.'});}
});
apiRouter.get('/campaigns/carousel/media/:mediaId', async (req,res)=>{
  try{res.type('image/jpeg').sendFile(await carouselImagePath(req.auth!.organizationId,String(req.params.mediaId)));}
  catch{res.status(404).json({error:'Imagem não encontrada.'});}
});
const campaignFilters = z.object({
  search: z.string().trim().max(160).optional(),
  status: z.enum(['draft','scheduled','running','paused','completed','cancelled']).optional(),
  from: z.iso.date().optional(), to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1)
}).refine(value=>!value.from||!value.to||value.from<=value.to,{message:'A data inicial deve ser anterior à final.'});
apiRouter.get('/campaigns/dashboard', requireManager, async (req,res) => {
  const parsed=campaignFilters.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({error:'Filtros inválidos.'});
  res.json(await campaignDashboard(req.auth!.organizationId,parsed.data));
});
apiRouter.get('/campaigns/:id/report', requireManager, async (req,res) => {
  const parsed=z.object({search:z.string().trim().max(160).optional(),status:z.enum(['pending','processing','sent','delivered','read','failed','cancelled']).optional(),page:z.coerce.number().int().min(1).max(100000).default(1)}).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({error:'Filtros inválidos.'});
  const report=await campaignReport(req.auth!.organizationId,String(req.params.id),parsed.data);
  if (!report) return res.status(404).json({error:'Campanha não encontrada.'});
  res.json(report);
});
apiRouter.get('/campaigns/:id/export', requireManager, async (req,res) => {
  const campaign=await getCampaign(req.auth!.organizationId,String(req.params.id));
  if (!campaign) return res.status(404).json({error:'Campanha não encontrada.'});
  const rows=await campaignExport(req.auth!.organizationId,String(req.params.id),req.query.failed==='true');
  if (req.query.format==='json') return res.json({items:rows});
  const keys=['name','phone','status','errorMessage','sentAt','deliveredAt','readAt'];
  const csv='\uFEFF'+['Nome;Telefone;Status;Erro;Enviado em (UTC);Entregue em (UTC);Lido em (UTC)',...rows.map(row=>keys.map(key=>csvCell(row[key])).join(';'))].join('\r\n');
  res.setHeader('Content-Disposition','attachment; filename="campanha.csv"');
  res.type('text/csv').send(csv);
});
apiRouter.delete('/campaigns/:id',requireAdmin,async(req,res)=>{
  const id=z.string().uuid().safeParse(req.params.id);
  if(!id.success)return res.status(400).json({error:'Campanha inválida.'});
  if(!await deleteCompletedCampaign(req.auth!.organizationId,id.data))return res.status(409).json({error:'A campanha não existe ou ainda não está concluída.'});
  res.json({ok:true});
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
    parameters: z.array(z.string().max(1024)).max(30).default([]),
    carouselCards: carouselCardsSchema,
    catalogProductIds: z.array(z.string().trim().min(1).max(128)).max(30).default([]),
    catalogSectionTitle: z.string().trim().min(1).max(24).default("Produtos"), delaySeconds: z.number().int().min(1).max(300),
    scheduledFor: z.coerce.date().optional(), recipients: z.array(z.object({ phone: z.string().max(32), name: z.string().max(160).optional() })).min(1).max(5000),
    saveContacts: z.boolean().default(false)
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Revise os dados, destinatários, template e intervalo da campanha." });
  try {
    const templates = (await listMessageTemplates()).data;
    const template = templates.find((item) => item.status === "APPROVED" && item.name === parsed.data.templateName && item.language === parsed.data.templateLanguage);
    if (!template) return res.status(422).json({ error: "Template não encontrado ou não aprovado pela Meta." });
    const snapshot = buildTemplateSnapshot(template as any, parsed.data.parameters, { autoContactName: true });
    for (const card of parsed.data.carouselCards) await carouselImagePath(req.auth!.organizationId,card.mediaId);
    snapshot.components.push(...buildCarouselComponents(template as any,parsed.data.carouselCards));
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
