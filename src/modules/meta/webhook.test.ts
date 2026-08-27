import { describe, expect, it } from "vitest";
import { extractText } from "./webhook.js";

describe("normalização de mensagens", () => {
  it("extrai texto e respostas interativas", () => {
    expect(extractText({ type: "text", text: { body: "Olá" } })).toBe("Olá");
    expect(extractText({ type: "interactive", interactive: { button_reply: { title: "Financeiro" } } })).toBe("Financeiro");
  });
});
