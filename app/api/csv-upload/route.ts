// app/api/csv-upload/route.ts
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Ожидаемый формат CSV:
// date,revenue,expenses,cac
// 2026-06-01,4200,3100,45
const REQUIRED_COLUMNS = ["date", "revenue", "expenses"];

function parseCsv(text: string) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV пустой или без данных");

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length) throw new Error(`Нет обязательных колонок: ${missing.join(", ")}`);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const cells = raw.split(",").map((c) => c.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => (row[h] = cells[idx]));

    const date = row["date"];
    const revenue = Number(row["revenue"]);
    const expenses = Number(row["expenses"]);
    const cac = row["cac"] ? Number(row["cac"]) : null;

    if (!date || isNaN(Date.parse(date))) {
      throw new Error(`Строка ${i + 1}: некорректная дата "${date}"`);
    }
    if (isNaN(revenue) || isNaN(expenses)) {
      throw new Error(`Строка ${i + 1}: revenue/expenses должны быть числами`);
    }

    rows.push({ date, revenue, expenses, cac });
  }

  if (rows.length === 0) throw new Error("Не найдено ни одной валидной строки");
  if (rows.length > 366) throw new Error("Максимум 366 строк за один загрузку");

  return rows;
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const email = formData.get("email") as string;
    const file = formData.get("file") as File;

    if (!email) return Response.json({ error: "email required" }, { status: 400 });
    if (!file) return Response.json({ error: "file required" }, { status: 400 });
    if (!file.name.toLowerCase().endsWith(".csv")) {
      return Response.json({ error: "Файл должен быть в формате .csv" }, { status: 400 });
    }
    if (file.size > 2 * 1024 * 1024) {
      return Response.json({ error: "Файл слишком большой (макс. 2 МБ)" }, { status: 400 });
    }

    const { data: appUser } = await admin
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (!appUser) return Response.json({ error: "Пользователь не найден" }, { status: 404 });

    const { data: business } = await admin
      .from("businesses")
      .select("id")
      .eq("user_id", appUser.id)
      .maybeSingle();
    if (!business) return Response.json({ error: "Бизнес не найден для пользователя" }, { status: 404 });

    const text = await file.text();
    let rows;
    try {
      rows = parseCsv(text);
    } catch (e: any) {
      return Response.json({ error: e.message }, { status: 400 });
    }

    const payload = rows.map((r) => ({
      business_id: business.id,
      date: r.date,
      revenue: r.revenue,
      expenses: r.expenses,
      cac: r.cac,
      source: "csv",
    }));

    const { error } = await admin
      .from("metrics_computed")
      .upsert(payload, { onConflict: "business_id,date" });

    if (error) {
      console.error("csv upsert error:", error);
      return Response.json({ error: "Ошибка записи в базу" }, { status: 500 });
    }

    return Response.json({ success: true, rows_imported: payload.length });
  } catch (e: any) {
    console.error("csv-upload error:", e);
    return Response.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}