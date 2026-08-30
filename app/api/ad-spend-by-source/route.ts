// app/api/ad-spend-by-source/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getPrimaryBusinessId } from "@/lib/get-primary-business";
import { UnauthorizedError } from "@/lib/require-user";
import {
  requireActiveSubscription,
  SubscriptionInactiveError,
  subscriptionErrorResponse,
} from "@/lib/require-active-subscription";

export const dynamic = "force-dynamic";

// ВАЖЛИВО (фікс): усі інші файли проєкту використовують SUPABASE_SERVICE_KEY
// (див. lib/alerts.mjs, scripts/*.mjs, усі інші app/api/*/route.*). Тут
// раніше був окремий SUPABASE_SERVICE_ROLE_KEY — іншого env-змінного імені,
// яке ніде більше не задається і не існує в оточенні проєкту. createClient
// з undefined-ключем або не створює робочого клієнта, або мовчки валить усі
// запити — тому цей віджет (Ad spend by source) або завжди повертав нулі,
// або падав з 500. Створюємо клієнта на верхньому рівні (той самий
// патерн, що і в решті /api/*), а не всередині GET — не по суті бага, але
// прибирає зайве повторне створення клієнта на кожен запит.
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function GET(req: Request) {
  // ФІКС (аудит 30.08.2026, п. 4): цей роут — платні CAC-дані (той самий
  // клас, що metrics/forecast/alerts), але раніше перевіряв лише
  // requireUser() ("залогінений хоч якось"), а не активність підписки.
  // Користувач з простроченим трайлом/заблокованою підпискою міг і далі
  // необмежено отримувати ці дані, поки решта платних роутів (metrics.ts,
  // forecast.ts, alerts.ts) вже давно ріжуть доступ через
  // requireActiveSubscription(). Приводимо до того самого стандарту.
  let email: string;
  try {
    ({ email } = await requireActiveSubscription());
  } catch (e) {
    if (e instanceof UnauthorizedError) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (e instanceof SubscriptionInactiveError) return subscriptionErrorResponse(e);
    throw e;
  }

  // ВАЖЛИВО (фікс): таблиця businesses НЕ МАЄ колонки email — усі інші
  // роути (metrics, alerts, business-profile тощо) спершу шукають users по
  // email, а вже потім businesses по user_id. Тут цей крок був пропущений
  // (.eq("email", email) на businesses), тож запит або падав з помилкою
  // Postgres (немає такої колонки), або нічого не знаходив — а .single()
  // нижче на порожньому результаті ще й кидає виняток замість null. Тепер
  // використовуємо той самий getPrimaryBusinessId(), що і решта дашборду.
  const { data: appUser } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!appUser) return NextResponse.json({ google: 0, meta: 0, googlePrev: 0, metaPrev: 0 });

  const businessId = await getPrimaryBusinessId(admin, appUser.id);
  if (!businessId) return NextResponse.json({ google: 0, meta: 0, googlePrev: 0, metaPrev: 0 });

  const now = new Date();
  const periodStart = new Date(now); periodStart.setDate(now.getDate() - 30);
  const prevPeriodStart = new Date(now); prevPeriodStart.setDate(now.getDate() - 60);

  // expenses.date — DATE-колонка (YYYY-MM-DD), як і скрізь у проєкті
  // (shopify-sync.mjs, sync-stripe-core.mjs). Порівнюємо теж рядком дати,
  // а не повним ISO-таймстампом — для узгодженості з рештою запитів і щоб
  // не залежати від того, як саме Postgres кастить timestamp -> date.
  const periodStartStr = periodStart.toISOString().slice(0, 10);
  const prevPeriodStartStr = prevPeriodStart.toISOString().slice(0, 10);

  const { data: expenses } = await admin
    .from("expenses")
    .select("source, amount, date")
    .eq("business_id", businessId)
    .gte("date", prevPeriodStartStr)
    .in("source", ["google_ads", "meta_ads"]);

  let google = 0, meta = 0, googlePrev = 0, metaPrev = 0;
  for (const e of expenses || []) {
    // ВАЖЛИВО (фікс): Supabase повертає numeric-колонки як РЯДКИ у JS —
    // без Number(...) тут "10" + "20" дало б рядок "1020" замість суми 30
    // (та сама поправка, що вже застосована в metrics/route.ts,
    // shopify-sync.mjs і решті sync-скриптів).
    const amount = Number(e.amount) || 0;
    const inCurrent = e.date >= periodStartStr;
    if (e.source === "google_ads") {
      inCurrent ? (google += amount) : (googlePrev += amount);
    } else if (e.source === "meta_ads") {
      inCurrent ? (meta += amount) : (metaPrev += amount);
    }
  }

  return NextResponse.json({ google, meta, googlePrev, metaPrev });
}