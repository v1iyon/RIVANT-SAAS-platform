import type { MetadataRoute } from "next";

// Нативний App Router sitemap (Next 13+): файл з такою назвою й сигнатурою
// автоматично віддається на /sitemap.xml — окремий пакет не потрібен.
// Раніше файлу не було взагалі, тож пошукові боти не мали явного списку
// публічних сторінок сайту.
//
// Хардкодимо origin через env, а не req.headers — sitemap генерується без
// запиту (build-time/ISR), заголовків там просто немає.
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://rivant.io";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  // Тільки реальні публічні сторінки лендінгу — dashboard/admin навмисно
  // не включені: вони за авторизацією, індексувати їх нема сенсу і не
  // варто підказувати боту, що такі шляхи взагалі існують.
  const routes: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }> = [
    { path: "", priority: 1, changeFrequency: "weekly" },
    { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
    { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
    { path: "/refund-policy", priority: 0.3, changeFrequency: "yearly" },
    { path: "/cookies", priority: 0.2, changeFrequency: "yearly" },
  ];

  return routes.map((route) => ({
    url: `${BASE_URL}${route.path}`,
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
