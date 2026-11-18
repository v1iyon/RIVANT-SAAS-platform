"use client"

// components/dashboard/shopify-connect.tsx
// Replaces the manual token input. `getAccessToken` must return the current Supabase session
// access token, e.g. async () => (await supabase.auth.getSession()).data.session?.access_token ?? null

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Lang = "en" | "uk" | "de"

const T = {
  en: {
    placeholder: "your-store.myshopify.com",
    connect: "Connect Shopify",
    redirecting: "Redirecting to Shopify…",
    connected: "Connected",
    pending: "Initial sync in progress",
    hint: "You'll be redirected to Shopify to approve read-only access.",
    separate: "This store is a separate revenue stream (not paid via Stripe)",
    invalid: "Enter your store domain, e.g. your-store.myshopify.com",
    failed: "Could not connect Shopify. Please try again.",
  },
  uk: {
    placeholder: "your-store.myshopify.com",
    connect: "Підключити Shopify",
    redirecting: "Переходимо до Shopify…",
    connected: "Підключено",
    pending: "Триває первинна синхронізація",
    hint: "Вас буде перенаправлено до Shopify, щоб надати доступ лише для читання.",
    separate: "Цей магазин — окремий потік грошей (оплата не через Stripe)",
    invalid: "Введіть домен магазину, наприклад your-store.myshopify.com",
    failed: "Не вдалося підключити Shopify. Спробуйте ще раз.",
  },
  de: {
    placeholder: "your-store.myshopify.com",
    connect: "Shopify verbinden",
    redirecting: "Weiterleitung zu Shopify…",
    connected: "Verbunden",
    pending: "Erste Synchronisierung läuft",
    hint: "Sie werden zu Shopify weitergeleitet, um den Lesezugriff zu bestätigen.",
    separate: "Dieser Shop ist ein separater Umsatzstrom (Zahlung nicht über Stripe)",
    invalid: "Shop-Domain eingeben, z. B. your-store.myshopify.com",
    failed: "Shopify konnte nicht verbunden werden. Bitte erneut versuchen.",
  },
} as const

function normalizeShop(raw: string): string | null {
  let s = raw.trim().toLowerCase().replace(/^https?:\/\//, "")
  const m = s.match(/^admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/)
  if (m) s = `${m[1]}.myshopify.com`
  s = s.split(/[/?#]/)[0]
  if (s && !s.includes(".")) s += ".myshopify.com"
  return /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/.test(s) ? s : null
}

export function ShopifyConnect({
  getAccessToken,
  businessId,
  lang = "en",
}: {
  getAccessToken: () => Promise<string | null>
  businessId?: string
  lang?: Lang
}) {
  const t = T[lang] ?? T.en
  const [shop, setShop] = useState("")
  const [separate, setSeparate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conn, setConn] = useState<{ shop_domain: string; sync_status: string } | null>(null)

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const pre = p.get("connect_shopify")
    if (pre) setShop(pre)
    if (p.get("shopify_error")) setError(t.failed)
    ;(async () => {
      const token = await getAccessToken()
      if (!token) return
      const r = await fetch("/api/shopify/status", { headers: { Authorization: `Bearer ${token}` } })
      if (r.ok) setConn((await r.json()).connection ?? null)
    })().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function connect() {
    setError(null)
    const normalized = normalizeShop(shop)
    if (!normalized) return setError(t.invalid)
    setBusy(true)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error("no session")
      const r = await fetch("/api/shopify/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ shop: normalized, businessId, revenueMode: separate ? "add" : "replace" }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.url) throw new Error(j.error || "failed")
      window.location.assign(j.url) // -> Shopify consent screen
    } catch {
      setError(t.failed)
      setBusy(false)
    }
  }

  if (conn) {
    return (
      <div className="space-y-1 text-sm">
        <p className="font-medium">
          {t.connected}: {conn.shop_domain}
        </p>
        {conn.sync_status === "pending" || conn.sync_status === "running" ? (
          <p className="text-muted-foreground">{t.pending}</p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={shop}
          onChange={(e) => setShop(e.target.value)}
          placeholder={t.placeholder}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          disabled={busy}
          onKeyDown={(e) => e.key === "Enter" && connect()}
        />
        <Button onClick={connect} disabled={busy || !shop.trim()}>
          {busy ? t.redirecting : t.connect}
        </Button>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={separate} onChange={(e) => setSeparate(e.target.checked)} disabled={busy} />
        {t.separate}
      </label>
      <p className="text-xs text-muted-foreground">{t.hint}</p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}