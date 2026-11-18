// app/api/shopify/status/route.js
import { NextResponse } from 'next/server'
import { admin, resolveUser } from '../../../../lib/shopify/server.mjs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  const userId = await resolveUser(request)
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data, error } = await admin()
    .from('shopify_connections')
    .select('shop_domain, sync_status, last_sync_at, installed_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('installed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 })
  return NextResponse.json({ connection: data ?? null })
}