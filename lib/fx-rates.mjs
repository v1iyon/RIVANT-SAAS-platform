// lib/fx-rates.mjs
//
// Спільний хелпер конвертації валют по історичному курсу — Frankfurter API
// (https://api.frankfurter.dev), безкоштовний, без ключа, дані ЄЦБ,
// історія курсів з 1999 року (перевірено по офіційному frankfurter.dev
// 03.09.2026, а не по пам'яті — саме тому раніше в paypal-sync.mjs чужа
// валюта просто пропускалась, а не конвертувалась: не хотів вигадувати
// джерело курсів наосліп).
//
// ВАЖЛИВО: ЄЦБ публікує курси лише для ~30 основних валют (не всі, які
// підтримує PayPal). Якщо валюти немає в довіднику ЄЦБ — функція кидає
// помилку, і виклик MUST впіймати її й пропустити конкретну транзакцію
// (не всю синхронізацію), як і раніше — тобто це safe fallback, не тиха
// хибна цифра.
//
// Кеш — проста Map у пам'яті процесу: один крон-прогін = один процес
// Node, кеш живе рівно на час прогону і зводить кількість HTTP-запитів до
// Frankfurter до "одна унікальна пара (дата, валюта) за прогін", а не
// "один запит на кожну транзакцію".
const cache = new Map();

export async function getExchangeRate(fromCurrency, toCurrency, dateStr) {
  const from = (fromCurrency || "").toUpperCase();
  const to = (toCurrency || "").toUpperCase();
  if (!from || !to) throw new Error(`Invalid currency pair: ${fromCurrency} -> ${toCurrency}`);
  if (from === to) return 1;

  const cacheKey = `${dateStr}:${from}:${to}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  // dateStr тут — локальна дата бізнесу (YYYY-MM-DD), той самий формат,
  // що очікує Frankfurter. Якщо дата — вихідний/свято (ЄЦБ курсів не
  // публікує), Frankfurter сам віддає найближчий попередній робочий день —
  // це штатна, документована поведінка джерела, не наша апроксимація.
  const url = `https://api.frankfurter.dev/v1/${dateStr}?base=${from}&symbols=${to}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`FX rate fetch failed (${from}->${to} on ${dateStr}): ${res.status} ${body}`.slice(0, 300));
  }
  const data = await res.json();
  const rate = data?.rates?.[to];
  if (!Number.isFinite(rate)) {
    throw new Error(`No FX rate available for ${from}->${to} on ${dateStr} (currency likely not covered by ECB reference rates)`);
  }

  cache.set(cacheKey, rate);
  return rate;
}
