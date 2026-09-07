// app/api/mfa/verify-backup-code/route.js
//
// Викликається з екрану "Введіть код 2FA" (components/dashboard —
// challenge у app/dashboard/page.tsx) на кроці "Немає доступу до
// authenticator? Використати backup-код".
//
// requireUser() тут навмисно ПРОПУСКАЄ перевірку AAL2 (сесія на цей момент
// — aal1, саме тому челлендж і показується) — сам факт валідної сесії вже
// підтверджує, що це той самий браузер/акаунт, який щойно увійшов паролем/
// magic-link. Backup-код — другий фактор ЗАМІСТЬ TOTP, а не заміна самого
// логіну.
//
// Після успішної звірки видаляємо ВСІ verified MFA-фактори користувача
// через supabase.auth.admin.mfa.deleteFactor() — backup-код за задумом
// означає "я загубив(-ла) свій authenticator", тож лишати старий TOTP-фактор
// підключеним немає сенсу (він для власника все одно недоступний). Це ж
// deleteFactor(), за документацією Supabase, обриває ВСІ активні сесії
// цього користувача (включно з поточною) — тому фронт після успіху мусить
// зробити signOut()/router.push("/") і попросити увійти ще раз; при
// повторному вході фактора вже нема, і aal2-челлендж не з'явиться.
import { createClient } from "@supabase/supabase-js";
import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/require-user";
import { hashBackupCode } from "@/lib/mfa-backup-codes";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export async function POST(req) {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    throw e;
  }

  const { code } = await req.json().catch(() => ({}));
  if (!code || typeof code !== "string") {
    return Response.json({ error: "code is required" }, { status: 400 });
  }

  const codeHash = hashBackupCode(code);

  const { data: match, error: matchErr } = await admin
    .from("mfa_backup_codes")
    .select("id")
    .eq("user_id", user.id)
    .eq("code_hash", codeHash)
    .is("used_at", null)
    .maybeSingle();
  if (matchErr) return Response.json({ error: "Verification failed, try again" }, { status: 500 });
  if (!match) return Response.json({ error: "invalid_or_used_code" }, { status: 400 });

  await admin.from("mfa_backup_codes").update({ used_at: new Date().toISOString() }).eq("id", match.id);

  const { data: factorsData, error: factorsErr } = await admin.auth.admin.mfa.listFactors({ userId: user.id });
  if (!factorsErr) {
    const verifiedFactors = (factorsData?.factors || []).filter((f) => f.status === "verified");
    for (const factor of verifiedFactors) {
      const { error: delErr } = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: user.id });
      if (delErr) console.error(`Failed to delete MFA factor ${factor.id} for user ${user.id}:`, delErr.message);
    }
  } else {
    console.error(`Failed to list MFA factors for user ${user.id}:`, factorsErr.message);
  }

  return Response.json({ ok: true, mustReauthenticate: true });
}
