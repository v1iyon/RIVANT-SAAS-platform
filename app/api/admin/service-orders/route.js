import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function checkAuth(req) {
  const secret = req.headers.get("x-admin-secret");
  return secret === process.env.ADMIN_SECRET;
}

export async function GET(req) {
  if (!checkAuth(req)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { data: orders, error } = await admin
    .from("service_orders")
    .select(
      `
      id,
      service_type,
      status,
      error_message,
      report_summary,
      paddle_transaction_id,
      created_at,
      delivered_at,
      business_id,
      users ( id, email, full_name )
    `
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ orders: orders || [] });
}

// Кнопка "Обработать pending сейчас" в админке. Дёргает тот же роут, что и
// крон, вручную — обрабатывает ВСЕ pending-заказы разом (до 20 за вызов,
// см. process-service-orders/route.js), а не один конкретный. Это не
// меняет vercel.json и не требует включать крон — просто ручной запуск
// той же логики по кнопке, пока process-service-orders не висит на кроне.
export async function POST(req) {
  if (!checkAuth(req)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const site = process.env.NEXT_PUBLIC_SITE_URL || `https://${req.headers.get("host")}`;
  const res = await fetch(`${site}/api/cron/process-service-orders`, {
    headers: { "x-cron-secret": process.env.CRON_SECRET },
  });
  const result = await res.json().catch(() => ({}));
  return Response.json({ triggered: true, cronResult: result });
}