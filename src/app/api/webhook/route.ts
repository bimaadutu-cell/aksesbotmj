import { NextRequest } from "next/server";
import { handleUpdate } from "@/lib/bot/engine";
import { WEBHOOK_SECRET } from "@/app/api/bot/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Endpoint webhook Telegram (mode webhook) — diverifikasi via secret_token */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (secret !== WEBHOOK_SECRET) return Response.json({ error: "unauthorized" }, { status: 403 });
  const update = await req.json().catch(() => null);
  if (update) void handleUpdate(update);
  return Response.json({ ok: true });
}
