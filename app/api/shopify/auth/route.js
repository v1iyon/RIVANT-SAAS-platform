// app/api/shopify/auth/route.js
// POST {shop, businessId?, revenueMode?} -> JSON {url}  (dashboard button, Bearer auth)
// GET ?shop=  -> 302 to Shopify consent screen (Shopify install link / App URL)
import { NextResponse } from 'next/server'
import {
  env, normalizeShop, verifyOAuthHmac, resolveUser, resolveBusinessId,
  createState, STATE_COOKIE, stateCookieOptions,
} from '../../../../lib/shopify/server.mjs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorizeUrl(shop, nonce) {
  const { clientId, scopes, appUrl } = env()
  const u = new URL(`https://${shop}/admin/oauth/authorize`)
  u.searchParams.set('client_id', clientId)
  u.searchParams.set('scope', scopes)
  u.searchParams.set('redirect_uri', `${appUrl}/api/shopify/callback`)
  u.searchParams.set('state', nonce)
  return u.toString()
}

export async function POST(request) {
  const userId = await resolveUser(request)
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const shop = normalizeShop(body?.shop)
  if (!shop) return NextResponse.json({ error: 'invalid_shop' }, { status: 400 })

  const businessId = await resolveBusinessId(userId, body?.businessId || null)
  if (!businessId) return NextResponse.json({ error: 'business_not_found' }, { status: 404 })

  const { nonce, cookie } = createState(userId, shop, { businessId, revenueMode: body?.revenueMode })
  const res = NextResponse.json({ url: authorizeUrl(shop, nonce) })
  res.cookies.set(STATE_COOKIE, cookie, stateCookieOptions())
  return res
}

export async function GET(request) {
  const { appUrl } = env()
  const sp = request.nextUrl.searchParams

  if (sp.get('hmac') && !verifyOAuthHmac(sp)) {
    return NextResponse.json({ error: 'invalid_hmac' }, { status: 400 })
  }
  const shop = normalizeShop(sp.get('shop'))
  if (!shop) return NextResponse.json({ error: 'invalid_shop' }, { status: 400 })

  const userId = await resolveUser(request)
  if (!userId) {
    // Browser redirect has no Bearer header: go to the dashboard (login required), it starts the flow via POST.
    return NextResponse.redirect(`${appUrl}/dashboard?connect_shopify=${encodeURIComponent(shop)}`)
  }
  const businessId = await resolveBusinessId(userId, null)
  if (!businessId) return NextResponse.redirect(`${appUrl}/dashboard?shopify_error=business_not_found`)

  const { nonce, cookie } = createState(userId, shop, { businessId })
  const res = NextResponse.redirect(authorizeUrl(shop, nonce))
  res.cookies.set(STATE_COOKIE, cookie, stateCookieOptions())
  return res
}