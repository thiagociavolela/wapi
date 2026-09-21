import { config, isMetaConfigured } from "../../config.js";

type MetaError = { message?: string; code?: number; error_data?: { details?: string }; fbtrace_id?: string };
interface MetaResponse { messages?: Array<{ id: string }>; error?: MetaError }
const metaErrorMessage = (error: MetaError | undefined, status: number) =>
  [error?.message ?? `Falha da Meta (${status}).`, error?.error_data?.details].filter(Boolean).join(" — ");

async function metaFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!config.META_ACCESS_TOKEN) throw new Error("Token da Meta não configurado.");
  const response = await fetch(`https://graph.facebook.com/${config.META_GRAPH_VERSION}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${config.META_ACCESS_TOKEN}`, ...init.headers }
  });
  const payload = await response.json() as T & { error?: MetaError };
  if (!response.ok) throw new Error(metaErrorMessage(payload.error, response.status));
  return payload;
}

export async function sendMetaMessage(to: string, message: Record<string, unknown>) {
  if (!isMetaConfigured()) throw new Error("A WhatsApp Cloud API ainda não foi configurada.");
  const response = await fetch(
    `https://graph.facebook.com/${config.META_GRAPH_VERSION}/${config.META_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${config.META_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...message })
    }
  );
  const payload = await response.json() as MetaResponse;
  if (!response.ok) throw new Error(metaErrorMessage(payload.error, response.status));
  const messageId = payload.messages?.[0]?.id;
  if (!messageId) throw new Error("A Meta não retornou o ID da mensagem.");
  return { messageId, payload };
}

export const sendText = (to: string, body: string, replyToMetaMessageId?: string) =>
  sendMetaMessage(to, { ...(replyToMetaMessageId ? { context: { message_id: replyToMetaMessageId } } : {}), type: "text", text: { body, preview_url: true } });

export const sendReaction = (to: string, messageId: string, emoji: string) =>
  sendMetaMessage(to, { type: "reaction", reaction: { message_id: messageId, emoji } });

export async function sendTypingIndicator(messageId: string) {
  if (!isMetaConfigured()) throw new Error("A WhatsApp Cloud API ainda não foi configurada.");
  const response = await fetch(`https://graph.facebook.com/${config.META_GRAPH_VERSION}/${config.META_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.META_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId, typing_indicator: { type: "text" } })
  });
  const payload = await response.json() as { success?: boolean; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? `Falha da Meta (${response.status}).`);
  return payload;
}

export const sendTemplate = (to: string, name: string, language: string, components: unknown[] = []) =>
  sendMetaMessage(to, { type: "template", template: { name, language: { code: language }, components } });

export async function uploadMedia(buffer: Buffer, mimeType: string, fileName: string) {
  if (!config.META_PHONE_NUMBER_ID) throw new Error("Número da Meta não configurado.");
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append("file", new Blob([new Uint8Array(buffer)], { type: mimeType }), fileName);
  const result = await metaFetch<{ id: string }>(`${config.META_PHONE_NUMBER_ID}/media`, { method: "POST", body: form });
  return result.id;
}

export async function sendMedia(to: string, type: "image" | "audio" | "video" | "document", mediaId: string, caption?: string, fileName?: string, voice = false) {
  const media: Record<string, unknown> = { id: mediaId };
  if (voice && type === "audio") media.voice = true;
  if (caption && type !== "audio") media.caption = caption;
  if (fileName && type === "document") media.filename = fileName;
  return sendMetaMessage(to, { type, [type]: media });
}

export async function downloadMedia(mediaId: string) {
  const metadata = await metaFetch<{ url: string; mime_type?: string; file_size?: number }>(mediaId);
  const response = await fetch(metadata.url, { headers: { Authorization: `Bearer ${config.META_ACCESS_TOKEN}` } });
  if (!response.ok) throw new Error(`Falha ao baixar mídia (${response.status}).`);
  return { buffer: Buffer.from(await response.arrayBuffer()), mimeType: metadata.mime_type ?? response.headers.get("content-type") ?? "application/octet-stream", fileSize: metadata.file_size };
}

export async function listMessageTemplates() {
  if (!config.META_WABA_ID) throw new Error("WABA ID não configurado.");
  return metaFetch<{ data: Array<{ id: string; name: string; status: string; category: string; language: string; components: Array<Record<string, unknown>> }> }>(
    `${config.META_WABA_ID}/message_templates?fields=id,name,status,category,language,components&limit=250`
  );
}

export interface CatalogProduct {
  id?: string;
  retailerId: string;
  name?: string;
  description?: string;
  price?: string | number;
  currency?: string;
  imageUrl?: string;
}

export async function getCatalogProduct(catalogId: string, retailerId: string): Promise<CatalogProduct | null> {
  const params = new URLSearchParams({
    fields: "id,name,description,price,currency,image_url,retailer_id",
    filter: JSON.stringify({ retailer_id: { eq: retailerId } }),
    limit: "10"
  });
  const payload = await metaFetch<{ data?: Array<Record<string, unknown>> }>(`${encodeURIComponent(catalogId)}/products?${params}`, {
    signal: AbortSignal.timeout(5000)
  });
  const item = payload.data?.find((candidate) => String(candidate.retailer_id ?? "") === retailerId) ?? payload.data?.[0];
  if (!item) return null;
  return {
    id: item.id ? String(item.id) : undefined,
    retailerId: String(item.retailer_id ?? retailerId),
    name: item.name ? String(item.name) : undefined,
    description: item.description ? String(item.description) : undefined,
    price: typeof item.price === "number" || typeof item.price === "string" ? item.price : undefined,
    currency: item.currency ? String(item.currency) : undefined,
    imageUrl: item.image_url ? String(item.image_url) : undefined
  };
}
