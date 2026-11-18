// app/api/shopify/callback/route.js
import { NextResponse } from 'next/server'
import {
  env, normalizeShop, verifyOAuthHmac, safeEqual, parseState,
  exchangeCode, saveConnection, triggerInitialSync,
  STATE_COOKIE, stateCookieOptions,
} from '../../../../lib/shopify/server.mjs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  const { appUrl } = env()
  const done = (qs) => {
    const res = NextResponse.redirect(`${appUrl}/dashboard?${qs}`)
    res.cookies.set(STATE_COOKIE, '', stateCookieOptions(0))
    return res
  }
  const fail = (code) => done(`shopify_error=${code}`)

  const sp = request.nextUrl.searchParams

  if (!verifyOAuthHmac(sp)) return fail('invalid_hmac')

  const shop = normalizeShop(sp.get('shop'))
  if (!shop) return fail('invalid_shop')
  const code = sp.get('code')
  const st = parseState(request.cookies.get(STATE_COOKIE)?.value)
  if (!code || !st || st.s !== shop || !safeEqual(st.n, sp.get('state') || '')) return fail('invalid_state')

  let tokens
  try {
    tokens = await exchangeCode(shop, code)
  } catch (e) {
    console.error('[shopify/callback] token exchange failed', e?.message)
    return fail('token_exchange_failed')
  }

  try {
    await saveConnection(st.u, shop, tokens, { businessId: st.b, revenueMode: st.m })
  } catch (e) {
    console.error('[shopify/callback] save failed', e?.message)
    return fail('save_failed')
  }

  await triggerInitialSync() // non-fatal; hourly cron also picks up the new integration

  return done(`shopify=connected&shop=${encodeURIComponent(shop)}`)
}