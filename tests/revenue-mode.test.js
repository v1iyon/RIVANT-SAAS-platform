// tests/revenue-mode.test.js
//
// lib/revenue-mode.js існує ЛИШЕ тому, що конфлікт двох "replace"-провайдерів
// одного разу вже тихо губив дохід (див. коментар на початку самого файлу).
// Ці тести фіксують саме той сценарій — щоб майбутня правка цієї логіки не
// повторила ту саму помилку непомітно.
import { describe, it, expect, vi } from "vitest";
import { effectiveRevenueMode, downgradeConflictingReplaceProviders, REPLACE_TOGGLE_PROVIDERS } from "../lib/revenue-mode.js";

describe("effectiveRevenueMode", () => {
  it("дефолтить на replace, якщо revenue_mode взагалі не заданий", () => {
    expect(effectiveRevenueMode(undefined)).toBe("replace");
    expect(effectiveRevenueMode({})).toBe("replace");
  });

  it("дефолтить на replace для будь-якого значення, крім рядка add", () => {
    expect(effectiveRevenueMode({ revenue_mode: "REPLACE" })).toBe("replace"); // регістр важливий, не нормалізується — це свідома поведінка коду
    expect(effectiveRevenueMode({ revenue_mode: "unknown" })).toBe("replace");
    expect(effectiveRevenueMode({ revenue_mode: null })).toBe("replace");
  });

  it("повертає add лише коли revenue_mode точно дорівнює add", () => {
    expect(effectiveRevenueMode({ revenue_mode: "add" })).toBe("add");
  });
});

// Мінімальний mock supabase-js chain (.from().select().eq().in() / .update().eq()),
// достатній саме для того, як downgradeConflictingReplaceProviders його викликає.
function makeAdminMock({ rows = [], selectError = null, updateError = null } = {}) {
  const updateCalls = [];
  const admin = {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => Promise.resolve({ data: rows, error: selectError }),
        }),
      }),
      update: (payload) => ({
        eq: (_col, id) => {
          updateCalls.push({ id, payload });
          return Promise.resolve({ error: updateError });
        },
      }),
    }),
  };
  return { admin, updateCalls };
}

describe("downgradeConflictingReplaceProviders", () => {
  it("нічого не робить, якщо requestedMode не replace (переходити в add ні з ким конфліктувати)", async () => {
    const { admin, updateCalls } = makeAdminMock({ rows: [{ id: "1", provider: "shopify", config: { revenue_mode: "replace" } }] });
    const result = await downgradeConflictingReplaceProviders(admin, "biz1", "woocommerce", "add");
    expect(result).toEqual([]);
    expect(updateCalls).toHaveLength(0);
  });

  it("понижує ІНШОГО replace-провайдера до add, коли поточний переходить у replace — саме той баг, що описаний у коментарі файлу", async () => {
    const { admin, updateCalls } = makeAdminMock({
      rows: [{ id: "shop-row-id", provider: "shopify", config: { revenue_mode: "replace" } }],
    });
    const downgraded = await downgradeConflictingReplaceProviders(admin, "biz1", "woocommerce", "replace");
    expect(downgraded).toEqual(["shopify"]);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload.config.revenue_mode).toBe("add");
  });

  it("не чіпає провайдера, який вже й так в add", async () => {
    const { admin, updateCalls } = makeAdminMock({
      rows: [{ id: "woo-row-id", provider: "woocommerce", config: { revenue_mode: "add" } }],
    });
    const downgraded = await downgradeConflictingReplaceProviders(admin, "biz1", "shopify", "replace");
    expect(downgraded).toEqual([]);
    expect(updateCalls).toHaveLength(0);
  });

  it("виключає САМ провайдер, що переходить у replace, зі списку кандидатів на конфлікт", async () => {
    let queriedProviders = null;
    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: (_col, providers) => {
              queriedProviders = providers;
              return Promise.resolve({ data: [], error: null });
            },
          }),
        }),
      }),
    };
    await downgradeConflictingReplaceProviders(admin, "biz1", "shopify", "replace");
    expect(queriedProviders).not.toContain("shopify");
    expect(queriedProviders.sort()).toEqual(REPLACE_TOGGLE_PROVIDERS.filter((p) => p !== "shopify").sort());
  });

  it("не падає, якщо запит на читання integrations впав — повертає порожній масив, а не кидає виняток", async () => {
    const { admin } = makeAdminMock({ selectError: { message: "boom" } });
    const result = await downgradeConflictingReplaceProviders(admin, "biz1", "shopify", "replace");
    expect(result).toEqual([]);
  });
});
