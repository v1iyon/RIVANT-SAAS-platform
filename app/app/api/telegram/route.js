import { bot } from "@/src/bot";
import { webhookCallback } from "grammy";

const handler = webhookCallback(bot, "std/http");

export async function POST(req) {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (secret !== process.env.WEBHOOK_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }
  return handler(req);
}

export async function GET() {
  return new Response("RIVANT telegram webhook is alive");
}