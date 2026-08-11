import { createClient } from "@supabase/supabase-js";

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

  // Без ORDER BY .limit(1) не гарантує, яку саме строку поверне Postgres,
  // якщо у користувача чомусь опинилось БІЛЬШЕ ОДНІЄЇ строки в businesses
  // (наприклад, з гонки двох паралельних перших завантажень дашборду, які
  // одночасно побачили "бізнесу нема" і обидва встигли створити свій).
  // Раніше це виглядало як "назва компанії/ID то є, то раптом пропадає" —
  // насправді просто щоразу підтягувалась інша строка. created_at ASC
  // робить вибір детермінованим (завжди найперша створена).
  let { data: business, error: businessError } = await admin
    .from("businesses")
    .select("*")
    .eq("user_id", appUser.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (businessError) {
    console.error("business-profile read error:", businessError);
    return Response.json({ error: businessError.message }, { status: 500 });
  }

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

export async function PUT(req) {
  const { email, name, timezone } = await req.json();
  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const { data: appUser } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!appUser) return Response.json({ error: "user not found" }, { status: 404 });

  const { data: business, error: businessError } = await admin
    .from("businesses")
    .select("*")
    .eq("user_id", appUser.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (businessError) return Response.json({ error: businessError.message }, { status: 500 });
  if (!business) return Response.json({ error: "business not found" }, { status: 404 });

  const updates = {};
  if (name !== undefined) updates[getBusinessNameColumn(business)] = name;
  if (timezone !== undefined) updates.timezone = timezone;

  const { error } = await admin.from("businesses").update(updates).eq("id", business.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
