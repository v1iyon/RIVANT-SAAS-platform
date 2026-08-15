// lib/get-primary-business.ts
//
// Единая точка получения "основного" бизнеса пользователя.
//
// У пользователя иногда оказывается БОЛЬШЕ ОДНОЙ строки в businesses —
// из-за гонки двух параллельных первых загрузок дашборда, которые
// одновременно не увидели бизнес и обе успели его создать (см. комментарий
// в app/api/business-profile/route.js, где это уже наблюдалось на проде).
//
// .maybeSingle() в Supabase/PostgREST возвращает ОШИБКУ, если строк больше
// одной — а не первую попавшуюся. Если эту ошибку не проверять, business
// тихо остаётся null/undefined и роут откатывается к "данных нет", хотя
// они есть. .order("created_at", { ascending: true }).limit(1) делает выбор
// детерминированным (всегда самая первая созданная строка) и полностью
// убирает саму возможность этой ошибки.
//
// Используйте этот хелпер вместо прямого .from("businesses")... в любом
// месте, где нужен ровно один (primary) бизнес пользователя — это тот же
// принцип, что уже применили к HISTORY_DAYS_BY_PLAN: одно место истины
// вместо N мест, которые могут разъехаться.
export async function getPrimaryBusinessId(
  admin: any,
  userId: string
): Promise<string | null> {
  const { data: business, error } = await admin
    .from("businesses")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("getPrimaryBusinessId error:", error);
    return null;
  }
  return business?.id ?? null;
}

export async function getPrimaryBusiness(
  admin: any,
  userId: string,
  columns: string = "id"
): Promise<Record<string, any> | null> {
  const { data: business, error } = await admin
    .from("businesses")
    .select(columns)
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("getPrimaryBusiness error:", error);
    return null;
  }
  return business ?? null;
}