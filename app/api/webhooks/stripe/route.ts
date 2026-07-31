import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js'; // Якщо використовуєш Supabase

// Ініціалізація Stripe з твоїм секретним ключем


// Ініціалізація Supabase (якщо використовуєш)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY! // Використовуй Service Role Key для запису!
);

export async function POST(req: Request) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2025-02-24.acacia',
  });
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );

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

  // 2. Обробляємо подію
  console.log(`🔔 Webhook received: ${event.type}`);

  switch (event.type) {
    case 'charge.succeeded':
      const charge = event.data.object as Stripe.Charge;
      console.log(`💰 Charge succeeded: ${charge.amount} ${charge.currency}`);

      // ТУТ ТИ ЗБЕРІГАЄШ ДАНІ В БАЗУ
      const { error } = await supabase.from('metric_computer').insert({
        user_id: 'ТВІЙ_TEСТОВИЙ_USER_ID', // Поки що хардкод, потім буде динамічно
        amount: charge.amount / 100,
        currency: charge.currency,
        status: charge.status,
        payment_method: charge.payment_method_details?.type || 'unknown',
        created_at: new Date(charge.created * 1000).toISOString(),
        // Додай інші поля, які тобі потрібні
      });

      if (error) {
        console.error('❌ Error saving to DB:', error);
        return NextResponse.json({ error: 'DB error' }, { status: 500 });
      }
      console.log('✅ Data saved to metric_computer');
      break;

    // Додай інші типи подій, якщо потрібно
    // case 'invoice.payment_succeeded': ...

    default:
      console.log(`ℹ️ Unhandled event type: ${event.type}`);
  }

  // 3. Відповідаємо Stripe, що все добре
  return NextResponse.json({ received: true });
}