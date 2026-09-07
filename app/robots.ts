import type { MetadataRoute } from "next";

// Нативний /robots.txt (той самий механізм, що й app/sitemap.ts). Явно
// закриваємо приватні контури (dashboard, admin, внутрішні API) — раніше
// robots.txt не існувало зовсім, тобто боти не мали НІЯКИХ вказівок і
// технічно могли намагатися індексувати навіть /admin чи /api/*.
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://rivant.io";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/admin", "/api/", "/reset-password"],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
