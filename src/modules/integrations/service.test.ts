import { describe, expect, it } from "vitest";
import { buildTemplateSnapshot, resolveApprovedTemplate } from "./service.js";

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

  it("monta o parâmetro de um botão com URL dinâmica", () => {
    const dynamic = { ...template, components: [...template.components, { type: "BUTTONS", buttons: [{ type: "URL", text: "Pagar", url: "https://example.com/pagar/{{1}}" }] }] };
    const result = buildTemplateSnapshot(dynamic, ["João", "nº 12345", "token-seguro"]);
    expect(result.components).toContainEqual({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "token-seguro" }] });
    expect(result.buttons[0].url).toBe("https://example.com/pagar/token-seguro");
    expect(result.parameterCount).toBe(3);
  });

  it("resolve o nome legado para o template aprovado na Meta", () => {
    const approved = [{ ...template, name: "pedido_pendente_finalizacao_br" }];
    expect(resolveApprovedTemplate(approved, "pedido_pendente_finalizacao", "pt_BR")?.name).toBe("pedido_pendente_finalizacao_br");
  });
});
