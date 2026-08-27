import { describe, expect, it } from "vitest";
import { extractChanges, extractText } from "./webhook.js";

describe("normalização de mensagens", () => {
  it("extrai texto e respostas interativas", () => {
    expect(extractText({ type: "text", text: { body: "Olá" } })).toBe("Olá");
    expect(extractText({ type: "interactive", interactive: { button_reply: { title: "Financeiro" } } })).toBe("Financeiro");
  });

  it("aceita o envelope oficial e a amostra direta do painel Meta", () => {
    const change = { field: "messages", value: { messages: [{ id: "wamid.1" }] } };
    expect(extractChanges(change)).toEqual([change]);
    expect(extractChanges({ object: "whatsapp_business_account", entry: [{ changes: [change] }] })).toEqual([change]);
  });
});
