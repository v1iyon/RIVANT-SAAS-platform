// supabase/functions/match-incoming-payment/index.ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async (req) => {
  if (!(await verifySignature(req))) {
    return new Response('Invalid signature', { status: 401 });
  }

  const payment = await req.json(); // { tx_hash, amount, from_address, to_address, network, tx_block_time }
  const amountCents = Math.round(payment.amount * 100);

  const { data, error } = await supabase.rpc('match_incoming_payment', {
    p_tx_hash: payment.tx_hash,
    p_amount_cents: amountCents,
    p_token: 'USDC',
    p_chain: payment.network,
    p_tx_block_time: payment.tx_block_time,
    p_raw_activity: {
      from_address: payment.from_address,
      to_address: payment.to_address,
    },
  });

  if (error) {
    console.error(error);
    return new Response('Internal error', { status: 500 });
  }

  return new Response(data, { status: 200 }); // 'matched' | 'no_pending_order' | ...
});

async function verifySignature(req: Request): Promise<boolean> {
  // HMAC-SHA256, тот же паттерн, что уже реализован для Paddle webhook
  // (app/api/webhooks/paddle/route.js) — используйте его как образец.
  return true; // TODO
}