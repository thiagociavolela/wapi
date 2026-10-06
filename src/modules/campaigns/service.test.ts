import { describe, expect, it } from "vitest";
import { normalizeCampaignPhone, parseCampaignContacts, personalizeCampaignTemplate } from "./service.js";
import { buildTemplateSnapshot } from "../integrations/service.js";

it("personaliza nome por destinatário sem exigir preenchimento manual", () => {
  const snapshot = buildTemplateSnapshot({ name: "marketing", status: "APPROVED", language: "pt_BR", category: "MARKETING", components: [{ type: "BODY", text: "Olá {{nome}}, oferta {{1}}!" }] }, ["especial"], { autoContactName: true });
  const imported = parseCampaignContacts("nome,telefone\nMaria,11917080051\nJoão,11950051301", "lista.csv").items;
  expect(imported.map(item => personalizeCampaignTemplate(snapshot.components, snapshot.text, item.name).text)).toEqual(["Olá Maria, oferta especial!", "Olá João, oferta especial!"]);
  const profile = personalizeCampaignTemplate(snapshot.components, snapshot.text, undefined, "Perfil", "Agenda");
  expect(profile.components).toEqual([{ type: "body", parameters: [{ type: "text", text: "Perfil", parameter_name: "nome" }, { type: "text", text: "especial" }] }]);
  expect(personalizeCampaignTemplate(snapshot.components, snapshot.text).text).toBe("Olá cliente, oferta especial!");
  expect(snapshot.text).toBe("Olá {{nome}}, oferta especial!");
});

describe("campaign contact import", () => {
  it("normalizes Brazilian local numbers and preserves international numbers", () => {
    expect(normalizeCampaignPhone("(11) 91708-0051")).toBe("5511917080051");
    expect(normalizeCampaignPhone("+1 415 555 0123")).toBe("14155550123");
    expect(normalizeCampaignPhone("123")).toBeNull();
  });

  it("reads CSV headers, removes duplicates and reports invalid rows", () => {
    const result = parseCampaignContacts("nome,telefone\nMaria,11917080051\nMaria repetida,5511917080051\nInválido,abc", "lista.csv");
    expect(result.items).toEqual([{ name: "Maria repetida", phone: "5511917080051" }]);
    expect(result.duplicates).toBe(1);
    expect(result.invalid).toEqual(["Inválido,abc"]);
  });
});
