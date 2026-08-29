import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../config.js", () => ({
  config: { META_GRAPH_VERSION: "v26.0", META_PHONE_NUMBER_ID: "phone-id", META_ACCESS_TOKEN: "token", META_WABA_ID: "waba-id" },
  isMetaConfigured: () => true
}));
import { sendMedia } from "./client.js";

describe("envio de áudio pela Meta", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("envia gravação OGG como áudio e não como documento ou texto", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.audio" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    await sendMedia("5511999999999", "audio", "media-123", undefined, "gravacao.ogg", false);

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      messaging_product: "whatsapp",
      to: "5511999999999",
      type: "audio",
      audio: { id: "media-123" }
    });
    expect(JSON.parse(String(request.body)).audio).not.toHaveProperty("voice");
  });
});
