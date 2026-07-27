import { NextResponse } from "next/server";

export const maxDuration = 60; // на Hobby-плане Vercel лимит 60s, на Pro можно больше

export async function GET(req) {
  // Защита от чужих вызовов — Vercel Cron сам добавляет этот заголовок
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { runSync } = await import("../../../../scripts/sync-stripe-core.js");
    const result = await runSync();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}