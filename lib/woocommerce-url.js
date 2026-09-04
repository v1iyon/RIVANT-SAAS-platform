// lib/woocommerce-url.js
//
// SSRF-защита для WooCommerce, той же принцип, що й normalizeShopDomain /
// isValidShopifyDomain для Shopify (див. scripts/shopify-sync.mjs,
// app/api/connect-integration/route.js) — але складніше, тому що у
// Shopify домен ЗАВЖДИ *.myshopify.com (фіксований суфікс, досить
// перевірити regex), а WooCommerce — це self-hosted WordPress на
// ДОВІЛЬНОМУ домені клієнта. Просто "домен містить крапку" тут не працює
// геть — свій домен матиме крапку так само, як "169.254.169.254"
// (AWS/GCP metadata) чи "10.0.0.5" (внутрішній сервіс).
//
// Тому тут два рівні захисту:
//   1. normalizeStoreUrl — синтаксична перевірка: тільки https://, без
//      userinfo (user:pass@), без порту :80/:8080 на звичайні порти для
//      обходу файрвола (порт дозволений, але не потрібен для 99% кейсів —
//      не блокуємо явно, WooCommerce інколи стоїть на нестандартному
//      порту за проксі), без IP-літералу як хоста, без localhost/*.local/
//      *.internal.
//   2. assertPublicHostname — DNS-резолв хоста і перевірка, що ЖОДНА з
//      резолвнутих адрес не потрапляє у приватний/reserved діапазон
//      (RFC1918, loopback, link-local у т.ч. cloud metadata 169.254.169.254,
//      unique-local IPv6). Викликається і при підключенні (connect-integration),
//      і при кожному синку (woocommerce-sync.mjs) — резолв на момент
//      підключення нічого не гарантує, якщо клієнт (чи атакуючий, що
//      підсунув чужий домен) пізніше перевказав DNS-запис на внутрішню
//      адресу (DNS rebinding).
const dns = require("node:dns/promises");
const net = require("node:net");

function normalizeStoreUrl(raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;

  let url;
  try {
    // Дозволяємо ввід без протоколу (yourstore.com) — типовий кейс, коли
    // клієнт копіює домен з адресного рядка, а не повний URL.
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null; // http:// навмисно не дозволяємо — ключі йдуть у заголовку Basic Auth
  if (url.username || url.password) return null; // "https://user:pass@host" — прихований спосіб протягнути інші креденшели
  if (!url.hostname) return null;

  const hostname = url.hostname.toLowerCase();

  if (net.isIP(hostname)) return null; // "https://169.254.169.254" і подібне — хост має бути ім'ям, не літералом IP
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) return null;
  if (!hostname.includes(".")) return null; // однослівний хост типу "http://backend" — не публічний домен

  // Нормалізуємо до "https://host" без trailing slash/path/query — REST-шлях
  // (/wp-json/wc/v3/...) додає сам sync-модуль.
  return `https://${hostname}`;
}

// RFC1918 + loopback + link-local (у т.ч. 169.254.169.254 — AWS/GCP/Azure
// metadata endpoint) + IPv6 unique-local/link-local/loopback.
function isPrivateOrReservedIp(ip) {
  const version = net.isIP(ip);
  if (version === 4) {
    const parts = ip.split(".").map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true; // link-local, включно з cloud metadata
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 0) return true;
    return false;
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true; // loopback
    if (lower.startsWith("fe80:")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local (fc00::/7)
    if (lower.startsWith("::ffff:")) {
      // IPv4-mapped IPv6 — перевіряємо саму IPv4-частину
      return isPrivateOrReservedIp(lower.replace("::ffff:", ""));
    }
    return false;
  }
  return true; // не розпізнано — трактуємо як небезпечне, безпечніший дефолт
}

// Кидає помилку, якщо хоч одна з резолвнутих адрес хоста приватна/reserved.
// Повертає нормально, якщо всі публічні (навіть якщо їх декілька — CDN/балансувальник).
async function assertPublicHostname(hostname) {
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch (err) {
    throw new Error(`Could not resolve WooCommerce store hostname: ${err.message}`);
  }
  if (!addresses.length) throw new Error("WooCommerce store hostname did not resolve to any address");
  for (const { address } of addresses) {
    if (isPrivateOrReservedIp(address)) {
      throw new Error("WooCommerce store URL resolves to a private/internal address — refusing to connect");
    }
  }
}

module.exports = { normalizeStoreUrl, assertPublicHostname, isPrivateOrReservedIp };
