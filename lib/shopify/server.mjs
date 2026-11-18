// lib/shopify/server.mjs
// Shared Shopify helpers: env, shop validation, HMAC, state cookie, token encryption,
// token storage + refresh. Plain ESM JS so it can be imported both from Next.js route
// handlers and from scripts/*.mjs sync scripts.
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

export const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-10'
export const STATE_COOKIE = 'rivant_shopify_state'

// ---------- env ----------
export function env() {
  const e = {
    clientId: process.env.SHOPIFY_API_KEY,
    secret: process.env.SHOPIFY_API_SECRET,
    scopes: process.env.SHOPIFY_SCOPES || 'read_orders,read_products,read_analytics,read_inventory',
    appUrl: (process.env.SHOPIFY_APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://rivant-os.com').replace(/\/$/, ''),
    encKey: process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY,
  }
  if (!e.clientId || !e.secret) throw new Error('SHOPIFY_API_KEY / SHOPIFY_API_SECRET are not set')
  return e
}

export function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// ---------- primitives ----------
export function safeEqual(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

// Strict shop validation (SSRF guard): only <handle>.myshopify.com, nothing else.
export function normalizeShop(input) {
  if (typeof input !== 'string') return null
  let s = input.trim().toLowerCase().replace(/^https?:\/\//, '')
  const adminMatch = s.match(/^admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/)
  if (adminMatch) s = `${adminMatch[1]}.myshopify.com`
  s = s.split(/[/?#]/)[0]
  if (s && !s.includes('.')) s += '.myshopify.com'
  return /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/.test(s) ? s : null
}

// OAuth callback / install request HMAC (hex over sorted query without `hmac`)
export function verifyOAuthHmac(searchParams) {
  const hmac = searchParams.get('hmac')
  if (!hmac) return false
  const pairs = []
  for (const [k, v] of searchParams.entries()) if (k !== 'hmac') pairs.push([k, v])
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const msg = pairs.map(([k, v]) => `${k}=${v}`).join('&')
  const digest = crypto.createHmac('sha256', env().secret).update(msg).digest('hex')
  return safeEqual(digest, hmac)
}

// Webhook HMAC (base64 over the RAW body)
export function verifyWebhookHmac(rawBody, headerValue) {
  if (!headerValue) return false
  const digest = crypto.createHmac('sha256', env().secret).update(rawBody, 'utf8').digest('base64')
  return safeEqual(digest, headerValue)
}

// ---------- signed state cookie (binds the OAuth round-trip to the RIVANT user) ----------
function sign(data) {
  return crypto.createHmac('sha256', env().secret).update(data).digest('base64url')
}

export function createState(userId, shop, extra = {}) {
  const nonce = crypto.randomBytes(16).toString('hex')
  // b = RIVANT business id, m = revenue mode ('replace' | 'add')
  const body = Buffer.from(JSON.stringify({ n: nonce, u: userId, s: shop, b: extra.businessId ?? null, m: extra.revenueMode === 'add' ? 'add' : 'replace', e: Date.now() + 10 * 60 * 1000 })).toString('base64url')
  return { nonce, cookie: `${body}.${sign(body)}` }
}

export function parseState(cookie) {
  if (!cookie) return null
  const [body, sig] = cookie.split('.')
  if (!body || !sig || !safeEqual(sign(body), sig)) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    return p.e > Date.now() ? p : null
  } catch {
    return null
  }
}

export function stateCookieOptions(maxAge = 600) {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/shopify', maxAge }
}

// ---------- token encryption (AES-256-GCM) ----------
function key() {
  const k = Buffer.from(process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY || '', 'base64')
  if (k.length !== 32) throw new Error('SHOPIFY_TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 (openssl rand -base64 32)')
  return k
}

export function encrypt(text) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
}

export function decrypt(payload) {
  const [v, iv, tag, ct] = String(payload).split(':')
  if (v !== 'v1') throw new Error('Unknown token format')
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8')
}

// ---------- auth (single swap point) ----------
// Resolves the RIVANT user (auth.users.id) from `Authorization: Bearer <supabase access token>`.
// If you prefer your existing requireUser() from lib/require-user.js, replace the body of this
// function with it and return the auth user id.
export async function resolveUser(request) {
  const m = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)
  if (!m) return null
  const { data, error } = await admin().auth.getUser(m[1])
  return error || !data?.user ? null : data.user.id
}

// ---------- Shopify token endpoint ----------
async function tokenRequest(shop, params, asForm = false) {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': asForm ? 'application/x-www-form-urlencoded' : 'application/json',
      Accept: 'application/json',
    },
    body: asForm ? new URLSearchParams(params).toString() : JSON.stringify(params),
    signal: AbortSignal.timeout(15000),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.access_token) throw new Error(`Shopify token request failed (${res.status})`)
  return json
}

// expiring=1 -> short-lived access token + refresh token (mandatory for new public apps)
export function exchangeCode(shop, code) {
  const { clientId, secret } = env()
  return tokenRequest(shop, { client_id: clientId, client_secret: secret, code, expiring: 1 })
}

function refreshTokens(shop, refreshToken) {
  const { clientId, secret } = env()
  return tokenRequest(shop, { client_id: clientId, client_secret: secret, grant_type: 'refresh_token', refresh_token: refreshToken }, true)
}

function tokensToRow(j) {
  const now = Date.now()
  return {
    access_token_enc: encrypt(j.access_token),
    refresh_token_enc: j.refresh_token ? encrypt(j.refresh_token) : null,
    access_token_expires_at: j.expires_in ? new Date(now + j.expires_in * 1000).toISOString() : null,
    refresh_token_expires_at: j.refresh_token_expires_in ? new Date(now + j.refresh_token_expires_in * 1000).toISOString() : null,
    scopes: j.scope ?? null,
  }
}

// ---------- storage ----------
// NOTE: businesses.user_id must match the auth user id used here. If your businesses.user_id
// stores public.users.id (not auth.uid()), adapt ONLY this function.
export async function resolveBusinessId(userId, requestedBusinessId) {
  let q = admin().from('businesses').select('id').eq('user_id', userId)
  if (requestedBusinessId) q = q.eq('id', requestedBusinessId)
  const { data } = await q.limit(1).maybeSingle()
  return data?.id ?? null
}

// Creates/updates the `integrations` row (so the existing sync + dashboard keep working)
// and stores the OAuth tokens in shopify_connections.
export async function saveConnection(userId, shop, tokens, { businessId = null, revenueMode = 'replace' } = {}) {
  const db = admin()
  let integrationId = null

  if (businessId) {
    const { data: ex, error: exErr } = await db
      .from('integrations').select('id, config').eq('business_id', businessId).eq('provider', 'shopify').maybeSingle()
    if (exErr) throw exErr
    const config = { ...(ex?.config || {}), shop_domain: shop, auth: 'oauth', revenue_mode: revenueMode }
    delete config.client_id
    delete config.sync_error_reason
    if (ex) {
      const { error } = await db.from('integrations').update({ status: 'connected', api_key_encrypted: 'oauth', config }).eq('id', ex.id)
      if (error) throw error
      integrationId = ex.id
    } else {
      const { data: ins, error } = await db
        .from('integrations')
        .insert({ business_id: businessId, provider: 'shopify', status: 'connected', api_key_encrypted: 'oauth', config })
        .select('id').single()
      if (error) throw error
      integrationId = ins.id
    }
  }

  const { data, error } = await db
    .from('shopify_connections')
    .upsert(
      {
        user_id: userId,
        business_id: businessId,
        integration_id: integrationId,
        shop_domain: shop,
        ...tokensToRow(tokens),
        status: 'active',
        sync_status: 'pending',
        disconnected_at: null,
        refresh_lock_until: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'shop_domain' },
    )
    .select('id')
    .single()
  if (error) throw error
  return data
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Always use this to get a usable Admin API token (route handlers AND sync scripts).
// Refreshes an expiring token when <5 min left; refresh is serialized per shop via a DB lock.
export async function getValidAccessToken(shop) {
  const db = admin()
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: c, error } = await db.from('shopify_connections').select('*').eq('shop_domain', shop).eq('status', 'active').maybeSingle()
    if (error) throw error
    if (!c?.access_token_enc) throw new Error('Shopify is not connected for this shop')

    const exp = c.access_token_expires_at ? new Date(c.access_token_expires_at).getTime() : null
    if (!exp || exp - Date.now() > 5 * 60 * 1000) return decrypt(c.access_token_enc)
    if (!c.refresh_token_enc) throw new Error('Shopify token expired and no refresh token: merchant must reinstall')

    const { data: locked } = await db
      .from('shopify_connections')
      .update({ refresh_lock_until: new Date(Date.now() + 30000).toISOString() })
      .eq('id', c.id)
      .or(`refresh_lock_until.is.null,refresh_lock_until.lt.${new Date().toISOString()}`)
      .select('id')
    if (!locked?.length) {
      await sleep(1500) // someone else is refreshing; re-read
      continue
    }
    try {
      const j = await refreshTokens(shop, decrypt(c.refresh_token_enc))
      const { error: upErr } = await db
        .from('shopify_connections')
        .update({ ...tokensToRow(j), refresh_lock_until: null, updated_at: new Date().toISOString() })
        .eq('id', c.id)
      if (upErr) throw upErr
      return j.access_token
    } catch (e) {
      await db.from('shopify_connections').update({ refresh_lock_until: null }).eq('id', c.id)
      throw e
    }
  }
  throw new Error('Could not refresh Shopify token')
}

// Kicks the existing hourly sync workflow right away (optional, non-fatal).
// Without GITHUB_DISPATCH_TOKEN the connection stays sync_status='pending' and the next cron run picks it up.
export async function triggerInitialSync() {
  const token = process.env.GITHUB_DISPATCH_TOKEN
  if (!token) return false
  const repo = process.env.GITHUB_REPO || 'v1iyon/RIVANT-SAAS-platform'
  const wf = process.env.GITHUB_SYNC_WORKFLOW || 'sync-stripe.yml'
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${wf}/dispatches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: JSON.stringify({ ref: 'main' }),
      signal: AbortSignal.timeout(8000),
    })
    return r.status === 204
  } catch {
    return false
  }
}
