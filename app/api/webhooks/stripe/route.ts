import { NextResponse } from 'next/server';
import Stripe from 'stripe';

// ВАЖНО: реальная запись Stripe-данных в metrics_computed происходит в
// scripts/sync-stripe-core.mjs (запускается через /api/sync-now и по крону) —
// именно там правильно резолвится business_id/user_id, считаются метрики,
// COGS-оценка и т.д. Этот вебхук раньше дублировал попытку писать данные
// напрямую, но: 1) в неправильную таблицу ('metric_computer' вместо
// 'metrics_computed' — опечатка), 2) с захардкоженным тестовым user_id.
// Из-за (1) каждый charge.succeeded от Stripe валился с 500, и Stripe
// бесконечно ретраил один и тот же вебхук.
//
// Теперь этот роут только подтверждает получение (200 OK), чтобы Stripe не
// ретраил вебхуки, и ничего не пишет в БД напрямую — единственный источник
// правды для метрик остаётся sync-stripe-core.mjs.
//
// ФІКС (аудит #2, знахідка №9): цей ЄДИНИЙ спільний вебхук в принципі не
// може знати, якому business_id належить подія (клієнти підключаються
// через restricted key, не Stripe Connect OAuth) — тому й раніше він міг
// лише "проковтнути" подію, не роблячи нічого корисного. Реальний фікс —
// app/api/webhooks/stripe/[businessId]/route.js: окремий URL і окремий
// підписуючий секрет на кожен бізнес, який RIVANT реєструє сам через Stripe
// API під час підключення ключа (lib/stripe-webhook.mjs). Цей файл
// лишається лише як заглушка для URL, який міг бути десь ще
// задокументований/введений вручну раніше — нових підключень сюди більше
// не спрямовуємо.
export async function POST(req: Request) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2025-02-24.acacia',
  });

  const body = await req.text();
  const sig = req.headers.get('stripe-signature')!;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

  let event: Stripe.Event;

  // 1. Перевіряємо, що вебхук дійсно від Stripe
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error('❌ Webhook signature verification failed.', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // 2. Просто підтверджуємо отримання — фактичний синк даних робить
  // sync-stripe-core.mjs (через /api/sync-now і крон), щоб уникнути
  // дублювання/розсинхрону логіки резолву business_id та підрахунку метрик.
  // (Прибрано console.log на кожен вебхук — раніше засмічував логи Vercel
  // при кожному вхідному евенті, див. п.17 аудиту.)

  // 3. Відповідаємо Stripe, що все добре — завжди 200, щоб Stripe не ретраїв
  // цей вебхук нескінченно через помилки в непотрібному нам записі в БД.
  return NextResponse.json({ received: true });
}