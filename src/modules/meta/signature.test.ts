import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { isValidMetaSignature } from "./signature.js";

describe("assinatura de webhook Meta", () => {
  it("aceita somente HMAC SHA-256 válido", () => {
    const body = Buffer.from('{"object":"whatsapp_business_account"}');
    const signature = `sha256=${crypto.createHmac("sha256", "secret").update(body).digest("hex")}`;
    expect(isValidMetaSignature(body, signature, "secret")).toBe(true);
    expect(isValidMetaSignature(body, signature, "wrong")).toBe(false);
  });
});
