import { config, isMetaConfigured } from "../../config.js";

interface MetaResponse { messages?: Array<{ id: string }>; error?: { message: string; code: number } }

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
  if (!response.ok) throw new Error(payload.error?.message ?? `Falha da Meta (${response.status}).`);
  const messageId = payload.messages?.[0]?.id;
  if (!messageId) throw new Error("A Meta não retornou o ID da mensagem.");
  return { messageId, payload };
}

export const sendText = (to: string, body: string) =>
  sendMetaMessage(to, { type: "text", text: { body, preview_url: true } });

export const sendTemplate = (to: string, name: string, language: string, components: unknown[] = []) =>
  sendMetaMessage(to, { type: "template", template: { name, language: { code: language }, components } });
