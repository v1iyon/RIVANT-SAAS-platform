// tests/quickbooks-categorize.test.js
//
// scripts/quickbooks-sync.mjs (і lib/alerts.mjs, яку воно імпортує)
// створює supabase-admin клієнт одразу при завантаженні модуля — без
// валідного NEXT_PUBLIC_SUPABASE_URL createClient() кидає "supabaseUrl is
// required." ще ДО того, як ми дістанемось до самої функції категоризації.
// Ставимо валідні за форматом (але фейкові) значення — конструктор клієнта
// це задовольняє і мережевих запитів не робить сам по собі; жоден мережевий
// виклик у цьому тесті й не відбувається, бо categorizeQuickbooksAccount —
// чиста функція без звернень до БД.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";

import { describe, it, expect } from "vitest";

const { categorizeQuickbooksAccount } = await import("../scripts/quickbooks-sync.mjs");

describe("categorizeQuickbooksAccount", () => {
  it("розпізнає рекламні рахунки", () => {
    expect(categorizeQuickbooksAccount("Advertising")).toBe("advertising");
    expect(categorizeQuickbooksAccount("Facebook Ads")).toBe("advertising");
    expect(categorizeQuickbooksAccount("Marketing & Promotion")).toBe("advertising");
  });

  it("розпізнає доставку", () => {
    expect(categorizeQuickbooksAccount("Shipping")).toBe("shipping");
    expect(categorizeQuickbooksAccount("Postage and Delivery")).toBe("shipping");
    expect(categorizeQuickbooksAccount("Freight Costs")).toBe("shipping");
  });

  it("розпізнає собівартість — саме ту категорію, яку код навмисно перевіряє РАНІШЕ за інші (див. коментар у файлі)", () => {
    expect(categorizeQuickbooksAccount("Cost of Goods Sold")).toBe("cost_of_goods");
    expect(categorizeQuickbooksAccount("COGS")).toBe("cost_of_goods");
    expect(categorizeQuickbooksAccount("Inventory Purchases")).toBe("cost_of_goods");
  });

  it("нетипову/невідому назву рахунку відносить в other, а не падає й не вгадує", () => {
    expect(categorizeQuickbooksAccount("Office Rent")).toBe("other");
    expect(categorizeQuickbooksAccount("Bank Fees")).toBe("other");
    expect(categorizeQuickbooksAccount("")).toBe("other");
    expect(categorizeQuickbooksAccount(undefined)).toBe("other");
    expect(categorizeQuickbooksAccount(null)).toBe("other");
  });

  it("не залежить від регістру назви рахунку", () => {
    expect(categorizeQuickbooksAccount("ADVERTISING")).toBe("advertising");
    expect(categorizeQuickbooksAccount("shipping")).toBe("shipping");
  });
});
