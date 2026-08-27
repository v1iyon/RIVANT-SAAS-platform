// lib/margin.js
//
// ЕДИНАЯ формула полной маржи (revenue - full cost incl. expenses),
// вынесена из src/bot.js (getFullMarginForDay), чтобы её использовали
// ВСЕ поверхности, которые показывают маржу пользователю: кабинет
// (app/api/metrics/route.ts), бот-команда "Метрики" (src/bot.js),
// прогноз (app/api/forecast/route.ts) и утренний/вечерний дайджест
// (scripts/daily-reports.mjs).
//
// РАНЬШЕ daily-reports.mjs брал metrics_computed.margin_pct "как есть"
// (без expenses — реклама Meta/Google Ads, реальная себестоимость из
// Shopify), а остальные три места добавляли expenses поверх — из-за
// этого дайджест показывал другую маржу, чем кабинет/бот/прогноз за
// тот же день (аудит #2, находка №1). Теперь все четыре места вызывают
// эту функцию.
//
// CommonJS специально (а не .mjs): src/bot.js — CommonJS (require()),
// а Node (cjs-module-lexer) уже умеет отдавать именованные экспорты из
// CommonJS-файлов в ESM import — этот же паттерн в проекте уже
// используется для lib/log-error.js, импортируемого из
// scripts/daily-reports.mjs (.mjs, ESM).

const { createClient } = require("@supabase/supabase-js");

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Доливает в margin_pct/cost реальные расходы (Shopify shipping/COGS,
 * Meta/Google Ads) за конкретный день поверх базовой стоимости из
 * metrics_computed.
 *
 * @param {string} businessId
 * @param {string} date - YYYY-MM-DD, локальная дата бизнеса
 * @param {number} revenue
 * @param {number} baseCost - cost из metrics_computed за этот день
 * @returns {Promise<{ fullCost: number, marginPct: number }>}
 */
async function getFullMarginForDay(businessId, date, revenue, baseCost) {
  const { data: expenseRows, error } = await admin
    .from("expenses")
    .select("amount")
    .eq("business_id", businessId)
    .eq("date", date);

  if (error) {
    // Не глушим молча (та же ошибка, что и находка №4) — но и не роняем
    // весь дайджест/бот/прогноз из-за временного сбоя чтения expenses:
    // возвращаем маржу без expenses (как раньше было ошибочно ВЕЗДЕ),
    // залогировав факт деградации, чтобы её было видно.
    console.error(`getFullMarginForDay: failed to load expenses for ${businessId} ${date}:`, error.message);
  }

  const extraTotal = (expenseRows || []).reduce((s, r) => s + Number(r.amount || 0), 0);
  const fullCost = Number((Number(baseCost || 0) + extraTotal).toFixed(2));
  const marginPct = revenue > 0 ? Number((((revenue - fullCost) / revenue) * 100).toFixed(1)) : 0;
  return { fullCost, marginPct };
}

module.exports = { getFullMarginForDay };
