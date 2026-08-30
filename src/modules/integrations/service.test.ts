import { describe, expect, it } from "vitest";
import { buildTemplateSnapshot } from "./service.js";

describe("buildTemplateSnapshot", () => {
  const template = {
    name: "pedido_recebido", status: "APPROVED", language: "pt_BR", category: "UTILITY",
    components: [
      { type: "HEADER", format: "TEXT", text: "Pedido recebido" },
      { type: "BODY", text: "Olá {{1}}, recebemos seu pedido {{2}}." },
      { type: "BUTTONS", buttons: [{ type: "URL", text: "Detalhes", url: "https://example.com" }] }
    ]
  };

  it("renderiza o conteúdo e cria parâmetros posicionais para a Meta", () => {
    const result = buildTemplateSnapshot(template, ["João", "nº 12345"]);
    expect(result.text).toBe("Pedido recebido\n\nOlá João, recebemos seu pedido nº 12345.");
    expect(result.components).toEqual([{ type: "body", parameters: [{ type: "text", text: "João" }, { type: "text", text: "nº 12345" }] }]);
    expect(result.buttons).toHaveLength(1);
  });

  it("rejeita quantidade incorreta de parâmetros", () => {
    expect(() => buildTemplateSnapshot(template, ["João"])).toThrow("exige 2 parâmetro");
  });
});
