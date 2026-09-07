// tests/margin.test.js
//
// getFullMarginForDay існує тому, що 4 різні поверхні (кабінет, бот,
// прогноз, дайджест) раніше рахували маржу по-різному й показували РІЗНІ
// цифри за той самий день (див. коментар на початку lib/margin.js). Ці
// тести фіксують формулу, щоб майбутня правка одного місця не розійшлася
// знову з іншими трьома.
//
// lib/margin.js створює supabase-admin клієнт через require() одразу при
// завантаженні модуля — vi.mock("@supabase/supabase-js") НЕ перехоплює цей
// виклик надійно (require() у CJS-файлі йде повз ESM-граф модулів, яким
// керує vi.mock). Замість цього підміняємо глобальний fetch — supabase-js
// v2 сам усередині робить звичайний fetch() до REST API, тож підмінений
// fetch дає повний контроль над відповіддю без внутрішнього мокання
// бібліотеки.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";

import { describe, it, expect, vi, beforeEach } from "vitest";

let mockExpenseRows = [];
let mockStatus = 200;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(mockExpenseRows), { status: mockStatus, headers: { "content-type": "application/json" } }))
  );
});

const { getFullMarginForDay } = await import("../lib/margin.js");

describe("getFullMarginForDay", () => {
  it("додає expenses поверх baseCost із metrics_computed", async () => {
    mockExpenseRows = [{ amount: 50 }, { amount: 30 }];
    mockStatus = 200;
    const { fullCost, marginPct } = await getFullMarginForDay("biz1", "2026-09-01", 1000, 400);
    expect(fullCost).toBe(480); // 400 (baseCost) + 50 + 30 (expenses)
    expect(marginPct).toBe(52); // (1000 - 480) / 1000 * 100
  });

  it("якщо additional expenses немає — маржа рахується лише від baseCost, без падіння в NaN/undefined", async () => {
    mockExpenseRows = [];
    mockStatus = 200;
    const { fullCost, marginPct } = await getFullMarginForDay("biz1", "2026-09-01", 1000, 400);
    expect(fullCost).toBe(400);
    expect(marginPct).toBe(60);
  });

  it("revenue = 0 -> marginPct = 0, а не Infinity/NaN від ділення на нуль", async () => {
    mockExpenseRows = [];
    mockStatus = 200;
    const { marginPct } = await getFullMarginForDay("biz1", "2026-09-01", 0, 0);
    expect(marginPct).toBe(0);
    expect(Number.isFinite(marginPct)).toBe(true);
  });

  it("помилка читання expenses не кидає виняток — деградує до маржі без expenses, а не валить викликача (бот/дайджест/прогноз)", async () => {
    mockExpenseRows = [];
    mockStatus = 500; // PostgREST-подібна помилка сервера
    const { fullCost, marginPct } = await getFullMarginForDay("biz1", "2026-09-01", 1000, 400);
    expect(fullCost).toBe(400);
    expect(marginPct).toBe(60);
  });

  it("округлює marginPct до 1 знаку, а fullCost до 2 — консистентно з тим, що показується в UI", async () => {
    mockExpenseRows = [{ amount: 33.333 }];
    mockStatus = 200;
    const { fullCost, marginPct } = await getFullMarginForDay("biz1", "2026-09-01", 700, 100);
    expect(fullCost).toBe(133.33);
    expect(marginPct).toBe(81); // (700 - 133.33) / 700 * 100 = 80.9528... -> toFixed(1) округлює до 81.0 -> 81
  });
});
