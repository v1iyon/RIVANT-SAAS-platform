// app/api/mfa/backup-codes/route.js
//
// GET  — скільки невикористаних backup-кодів лишилось у поточного
//        користувача (для банера в Settings "лишилось 3 з 10 — перегенерувати?").
// POST — згенерувати нову партію з 10 кодів. СТАРІ невикористані коди при
//        цьому видаляються — не можна мати кілька одночасно "живих" партій,
//        інакше користувач не зрозуміє, який саме набір з можливо кількох
//        збережених файлів досі дійсний.
//
// requireUser() тут достатньо (без перевірки AAL2) — цей ендпоінт кличеться
// ОДРАЗУ після успішного enroll TOTP (де AAL2 щойно підтверджено в цій же
// сесії) або з Settings, куди й так не потрапити без сесії.
import { createClient } from "@supabase/supabase-js";
import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/require-user";
import { generateBackupCodes } from "@/lib/mfa-backup-codes";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    throw e;
  }

  const { count, error } = await admin
    .from("mfa_backup_codes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("used_at", null);
  if (error) return Response.json({ error: "Failed to load backup codes status" }, { status: 500 });

  return Response.json({ remaining: count || 0 });
}

export async function POST() {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    throw e;
  }

  const { plainCodes, hashes } = generateBackupCodes();

  // Спочатку прибираємо стару партію (і використані, і ще живі — щойно
  // згенерована нова партія повністю її замінює), потім вставляємо нову.
  // Якщо insert впаде — краще лишити користувача БЕЗ backup-кодів явно
  // (побачить remaining: 0 і згенерує ще раз), ніж мовчки лишити стару
  // партію поряд з частково вставленою новою.
  await admin.from("mfa_backup_codes").delete().eq("user_id", user.id);

  const { error: insertErr } = await admin
    .from("mfa_backup_codes")
    .insert(hashes.map((code_hash) => ({ user_id: user.id, code_hash })));
  if (insertErr) {
    console.error("Failed to store new backup codes:", insertErr.message);
    return Response.json({ error: "Failed to generate backup codes" }, { status: 500 });
  }

  return Response.json({ codes: plainCodes });
}
