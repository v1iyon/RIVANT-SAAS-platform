// app/api/shopify/webhooks/route.js
// One endpoint for: customers/data_request, customers/redact, shop/redact, app/uninstalled.
import { NextResponse } from 'next/server'
import { admin, verifyWebhookHmac } from '../../../../lib/shopify/server.mjs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COMPLIANCE = new Set(['customers/data_request', 'customers/redact', 'shop/redact'])

export async function POST(request) {
  const raw = await request.text()
  if (!verifyWebhookHmac(raw, request.headers.get('x-shopify-hmac-sha256'))) {
    return new NextResponse('invalid signature', { status: 401 })
  }

  const topic = request.headers.get('x-shopify-topic') || ''
  const shop = (request.headers.get('x-shopify-shop-domain') || '').toLowerCase()
  const webhookId = request.headers.get('x-shopify-webhook-id') || null
  let payload = null
  try { payload = JSON.parse(raw) } catch { /* keep null */ }

  const db = admin()

  try {
    if (COMPLIANCE.has(topic)) {
      const { error } = await db
        .from('shopify_compliance_requests')
        .insert({ webhook_id: webhookId, topic, shop_domain: shop, payload })
      if (error?.code === '23505') return new NextResponse('ok', { status: 200 }) // duplicate delivery

      if (topic === 'shop/redact') {
        const { data: conn } = await db
          .from('shopify_connections').select('business_id, integration_id').eq('shop_domain', shop).maybeSingle()
        if (conn?.business_id) {
          // Shopify-sourced expenses are shop data -> erase. metrics_computed holds merged revenue
          // (may include Stripe), so it is NOT touched here.
          await db.from('expenses').delete().eq('business_id', conn.business_id).eq('source', 'shopify')
        }
        if (conn?.integration_id) await db.from('integrations').delete().eq('id', conn.integration_id)
        await db.from('shopify_connections').delete().eq('shop_domain', shop)
      }
      // customers/data_request, customers/redact: RIVANT's Shopify sync reads no customer fields
      // (no customer/email/address in GraphQL queries), so there is no customer PII to export or delete.

      if (webhookId) {
        await db.from('shopify_compliance_requests').update({ processed_at: new Date().toISOString() }).eq('webhook_id', webhookId)
      }
    } else if (topic === 'app/uninstalled') {
      const { data: conn } = await db
        .from('shopify_connections')
        .update({
          status: 'disconnected',
          access_token_enc: null,
          refresh_token_enc: null,
          access_token_expires_at: null,
          refresh_token_expires_at: null,
          sync_status: 'idle',
          disconnected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('shop_domain', shop)
        .select('integration_id')
        .maybeSingle()

      // Sync only picks integrations with status connected/error, so this stops it.
      // If integrations.status has a CHECK constraint without 'disconnected', use an allowed value here.
      if (conn?.integration_id) {
        await db.from('integrations').update({ status: 'disconnected' }).eq('id', conn.integration_id)
      }
    }
  } catch (e) {
    console.error('[shopify/webhooks]', topic, e?.message)
    return new NextResponse('error', { status: 500 })
  }

  return new NextResponse('ok', { status: 200 })
}