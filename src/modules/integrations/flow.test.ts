import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), tx: vi.fn(), begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), send: vi.fn(), templates: vi.fn() }));
vi.mock("../../config.js", () => ({ config: { INTEGRATION_API_KEY: "test-integration-key" } }));
vi.mock("../../database/pool.js", () => ({ pool: { execute: mocks.execute, getConnection: async () => ({ execute: mocks.tx, beginTransaction: mocks.begin, commit: mocks.commit, rollback: mocks.rollback, release: mocks.release }) } }));
vi.mock("../conversations/service.js", () => ({ defaultOrganizationId: async () => "org-test" }));
vi.mock("../meta/client.js", () => ({ listMessageTemplates: mocks.templates, sendTemplate: mocks.send }));
vi.mock("../realtime/events.js", () => ({ publish: vi.fn() }));
import { integrationRouter } from "../../routes/integrations.js";
import { buildTemplateSnapshot, processJobs } from "./service.js";

const definition = { name: "entrega_iniciada_motoboy", status: "APPROVED", language: "pt_BR", category: "UTILITY", components: [
  { type: "BODY", text: "Olá, {{nome}}!" },
  { type: "BUTTONS", buttons: [{ type: "URL", text: "Acompanhar Pedido", url: "https://providafarma.com/rastrear-entrega?t={{1}}" }] }
] };
const expected = [
  { type: "body", parameters: [{ type: "text", parameter_name: "nome", text: "Teste de integracao" }] },
  { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "TOKEN_PUBLICO" }] }
];
const payload = { to: "5511917080051", contactName: "Teste de integracao", template: definition.name, language: "pt_BR", parameters: ["Teste de integracao"], buttonParameters: ["TOKEN_PUBLICO"], externalId: "IDENTIFICADOR_UNICO", metadata: { event: "order.delivery_started", source: "site", orderId: "TESTE-WHATSAPP-INICIO" } };
let server: Server | undefined;
let base: string;
let job: any;
let messageContent: any;

beforeEach(async () => {
  vi.clearAllMocks(); job = undefined; messageContent = undefined;
  mocks.templates.mockResolvedValue({ data: [definition] });
  mocks.send.mockResolvedValue({ messageId: "wamid.test" });
  mocks.tx.mockImplementation(async (sql: string, args: any[]) => {
    if (sql.includes("SELECT j.id")) return [job ? [{ id: job.id, status: "pending" }] : []];
    if (sql.includes("SELECT id FROM contacts")) return [[{ id: "contact-test" }]];
    if (sql.includes("SELECT id FROM conversations")) return [[{ id: "conversation-test" }]];
    if (sql.includes("INSERT INTO messages")) messageContent = JSON.parse(args[4]);
    if (sql.includes("INSERT INTO integration_message_jobs")) job = { id: args[0], organizationId: args[1], conversationId: args[2], messageId: args[3], phone: args[6], templateName: args[7], language: args[8], parameters: args[9], attempts: 0, content: JSON.stringify(messageContent) };
    return [{ affectedRows: 1 }];
  });
  // Creation runs only this job; scheduled test inputs are not eligible yet.
  mocks.execute.mockImplementation(async (sql: string) => sql.includes("SELECT j.id") ? [[]] : [{ affectedRows: 1 }]);
  const app = express(); app.use(express.json()); app.use("/api/integrations", integrationRouter);
  server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterEach(async () => { if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve())); });

async function post(body: unknown, key = "test-delivery-unique") {
  return fetch(`${base}/api/integrations/messages`, { method: "POST", headers: { Authorization: "Bearer test-integration-key", "Idempotency-Key": key, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
async function runJob(stored = job) {
  mocks.execute.mockImplementation(async (sql: string) => sql.includes("SELECT j.id") ? [[stored]] : [{ affectedRows: 1 }]);
  await processJobs(stored.id);
}

describe("contrato de integração e worker", () => {
  it("preserva nome/token separados no endpoint e job e reconstrói os componentes sem depender do snapshot", async () => {
    expect((await post(payload)).status).toBe(202);
    expect(JSON.parse(job.parameters)).toEqual({ parameters: payload.parameters, buttonParameters: payload.buttonParameters });
    expect(messageContent.components).toEqual(expected);
    expect(messageContent.buttonParameters).toEqual(["TOKEN_PUBLICO"]);
    await runJob({ ...job, content: JSON.stringify({ components: [], metadata: { nome: "NOME ERRADO" } }) });
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith("5511917080051", definition.name, "pt_BR", expected);
    expect(mocks.execute.mock.calls.some(([sql]) => sql.includes("status = 'sent'"))).toBe(true);
  });

  it("mantém arrays legados contendo corpo e botão e recupera snapshot vazio", async () => {
    const { buttonParameters, ...legacy } = payload;
    expect((await post({ ...legacy, parameters: [...legacy.parameters, ...buttonParameters] })).status).toBe(202);
    expect(JSON.parse(job.parameters)).toEqual(["Teste de integracao", "TOKEN_PUBLICO"]);
    await runJob({ ...job, content: JSON.stringify({ components: [] }) });
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(payload.to, definition.name, "pt_BR", expected);
  });

  it("não cria outro job ao repetir a chave de idempotência", async () => {
    const first = await post(payload); const result = await first.json();
    const repeated = await post(payload);
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({ id: result.id, duplicate: true });
    expect(mocks.tx.mock.calls.filter(([sql]) => sql.includes("INSERT INTO integration_message_jobs"))).toHaveLength(1);
  });

  it.each([
    { ...payload, buttonParameters: { token: "bad" } },
    { ...payload, buttonParameters: [null] }
  ])("rejeita formato inválido de botão antes de persistir", async (body) => {
    expect((await post(body)).status).toBe(400); expect(mocks.tx).not.toHaveBeenCalled();
  });

  it.each([
    { ...payload, parameters: [] }, { ...payload, buttonParameters: [] },
    { ...payload, parameters: ["Nome", "EXTRA"] }, { ...payload, buttonParameters: ["TOKEN", "EXTRA"] },
    { ...payload, language: "en_US" }
  ])("rejeita parâmetros incompatíveis sem aceitar na fila", async (body) => {
    expect((await post(body)).status).toBe(422); expect(mocks.tx).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });

  it("reconstrói snapshots legados que omitiram o corpo sem perder parâmetros do job", async () => {
    await post(payload);
    await runJob({ ...job, parameters: JSON.stringify(["Teste de integracao", "TOKEN_PUBLICO"]), content: JSON.stringify({ components: [expected[1]] }) });
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(payload.to, definition.name, "pt_BR", expected);
  });

  it("valida botões separadamente mesmo quando o cadastro lista BUTTONS antes de BODY", () => {
    expect(buildTemplateSnapshot({ ...definition, components: [...definition.components].reverse() }, payload.parameters, { buttonParameters: payload.buttonParameters }).components).toEqual([...expected].reverse());
  });
});
