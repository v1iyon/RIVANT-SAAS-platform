// backfill-integrations-selected.mjs
//
// Цель: для всех Starter/Growth аккаунтов, у которых Stripe реально подключён
// (integrations.status = 'connected'), но отсутствует в
// subscriptions.integrations_selected — дописать "stripe" в этот массив.
//
// Схема связей:
//   subscriptions.user_id -> users.id
//   businesses.user_id    -> users.id
//   integrations.business_id -> businesses.id
//
// Запуск:
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node backfill-integrations-selected.mjs
//
// Сначала пройдёт в режиме DRY RUN (только печатает, что бы сделал) —
// чтобы реально записать изменения, запусти с флагом --apply

import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY in env"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log(APPLY ? "=== APPLY MODE ===" : "=== DRY RUN (no writes) ===");

  // 1. Все subscriptions на Starter/Growth
  const { data: subs, error: subsErr } = await supabase
    .from("subscriptions")
    .select("id, user_id, plan, integrations_selected")
    .in("plan", ["starter", "growth"]);

  if (subsErr) throw subsErr;
  console.log(`Found ${subs.length} starter/growth subscriptions`);

  // 2. Все businesses (нужна связка user_id -> business.id)
  const { data: businesses, error: bizErr } = await supabase
    .from("businesses")
    .select("id, user_id");

  if (bizErr) throw bizErr;

  const businessByUserId = new Map(businesses.map((b) => [b.user_id, b.id]));

  // 3. Все connected интеграции
  const { data: integrations, error: intErr } = await supabase
    .from("integrations")
    .select("business_id, provider, status");

  if (intErr) throw intErr;

  const connectedProvidersByBusinessId = new Map();
  for (const row of integrations) {
    if (row.status !== "connected") continue;
    const list = connectedProvidersByBusinessId.get(row.business_id) ?? [];
    list.push(row.provider);
    connectedProvidersByBusinessId.set(row.business_id, list);
  }

  let toUpdate = 0;
  let skippedNoBusiness = 0;

  for (const sub of subs) {
    const businessId = businessByUserId.get(sub.user_id);
    if (!businessId) {
      skippedNoBusiness++;
      console.log(
        `  ! No business found for user_id=${sub.user_id} (subscription ${sub.id}) — skipping`
      );
      continue;
    }

    const connectedProviders =
      connectedProvidersByBusinessId.get(businessId) ?? [];
    if (connectedProviders.length === 0) continue;

    const currentSelected = new Set(sub.integrations_selected ?? []);
    const missing = connectedProviders.filter((p) => !currentSelected.has(p));

    if (missing.length === 0) continue;

    toUpdate++;
    const newSelected = Array.from(
      new Set([...currentSelected, ...connectedProviders])
    );

    console.log(
      `  -> subscription ${sub.id} (user ${sub.user_id}, plan ${sub.plan}): ` +
        `add [${missing.join(", ")}] -> integrations_selected = [${newSelected.join(", ")}]`
    );

    if (APPLY) {
      const { error: updateErr } = await supabase
        .from("subscriptions")
        .update({ integrations_selected: newSelected })
        .eq("id", sub.id);

      if (updateErr) {
        console.error(`     FAILED for ${sub.id}:`, updateErr.message);
      }
    }
  }

  console.log("");
  console.log(`Done. ${toUpdate} subscription(s) ${APPLY ? "updated" : "would be updated"}.`);
  if (skippedNoBusiness > 0) {
    console.log(
      `${skippedNoBusiness} subscription(s) skipped — no matching business found, check manually.`
    );
  }
  if (!APPLY) {
    console.log("Re-run with --apply to actually write changes.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
