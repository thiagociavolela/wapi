import { describe, expect, it } from "vitest";
import { normalizeCampaignPhone, parseCampaignContacts } from "./service.js";

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
