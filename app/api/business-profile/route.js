import { createClient } from "@supabase/supabase-js";
import { getPrimaryBusiness } from "@/lib/get-primary-business";
import { DIGEST_FREQUENCIES } from "@/lib/alerts.mjs";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function normalizeBusiness(row) {
  if (!row) return null;
  return {
    ...row,
    // Older Supabase projects used company_name/business_name instead of name.
    // The dashboard always receives one stable `name` field.
    name: row.name ?? row.company_name ?? row.business_name ?? "",
  };
}

function getBusinessNameColumn(row) {
  if (Object.prototype.hasOwnProperty.call(row || {}, "name")) return "name";
  if (Object.prototype.hasOwnProperty.call(row || {}, "company_name")) return "company_name";
  if (Object.prototype.hasOwnProperty.call(row || {}, "business_name")) return "business_name";
  return "name";
}

export async function GET(req) {
  const email = new URL(req.url).searchParams.get("email");
  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const { data: appUser } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!appUser) {
    return Response.json({ error: "Application user was not initialized" }, { status: 404 });
  }

  // Единый хелпер (lib/get-primary-business.ts) детерминированно выбирает
  // самую первую созданную строку в businesses и обрабатывает случай, когда
  // их у пользователя оказалось больше одной (гонка двух параллельных
  // первых загрузок дашборда, которые одновременно не увидели бизнес и обе
  // успели его создать).
  let business = await getPrimaryBusiness(admin, appUser.id, "*");

  // Если бизнеса ещё нет — создаём пустой, чтобы было что редактировать
  if (!business) {
    const { data: created, error: createError } = await admin
      .from("businesses")
      .insert({ user_id: appUser.id, name: "My Business" })
      .select("*")
      .single();
    if (createError) {
      console.error("business-profile create error:", createError);
      return Response.json({ error: createError.message }, { status: 500 });
    }
    business = created;
  }

  return Response.json({ business: normalizeBusiness(business) });
}

const VALID_ALERT_SENSITIVITY = ["low", "normal", "high"];

export async function PUT(req) {
  const { email, name, timezone, alert_sensitivity, digest_frequency } = await req.json();
  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const { data: appUser } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!appUser) return Response.json({ error: "user not found" }, { status: 404 });

  const business = await getPrimaryBusiness(admin, appUser.id, "*");
  if (!business) return Response.json({ error: "business not found" }, { status: 404 });

  const updates = {};
  if (name !== undefined) updates[getBusinessNameColumn(business)] = name;
  if (timezone !== undefined) updates.timezone = timezone;
  // Валідація тут (а не тільки CHECK-констрейнт у БД) — щоб сміттєве
  // значення не пішло навіть у вигляді помилки 500 з боку Postgres, а
  // просто мовчки ігнорувалось. Sync-скрипти (lib/alerts.mjs) все одно
  // fallback'аються на "normal" для будь-якого невідомого значення, так що
  // це друга лінія захисту, а не єдина.
  if (alert_sensitivity !== undefined && VALID_ALERT_SENSITIVITY.includes(alert_sensitivity)) {
    updates.alert_sensitivity = alert_sensitivity;
  }
  if (digest_frequency !== undefined && DIGEST_FREQUENCIES.includes(digest_frequency)) {
    updates.digest_frequency = digest_frequency;
  }

  const { error } = await admin.from("businesses").update(updates).eq("id", business.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}