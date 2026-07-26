import { NextRequest } from "next/server";
import { tg } from "@/lib/telegram";
import { encrypt, maskToken, rateLimit } from "@/lib/crypto";
import { getConfig, getToken, upsertConfig, DEFAULT_SETTINGS } from "@/lib/store";
import { ensureEngine, stopEngine, refreshConfig, live } from "@/lib/bot/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const WEBHOOK_SECRET = "abm-wh-" + (process.env.TOKEN_SECRET || "aksesbotmu").slice(0, 24);

function ip(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

export async function GET() {
  const cfg = await getConfig();
  return Response.json({
    connected: !!(cfg?.active && cfg?.tokenEnc),
    bot: cfg
      ? {
          id: cfg.botId, name: cfg.botName, username: cfg.botUsername,
          description: cfg.description, mode: cfg.mode ?? "polling",
          webhookUrl: cfg.webhookUrl,
          tokenMasked: cfg.tokenEnc ? maskToken(getToken(cfg) ?? "") : null,
          photoUrl: cfg.botPhotoPath ? `/api/file?path=${encodeURIComponent(cfg.botPhotoPath)}` : null,
          connectedAt: cfg.connectedAt, lastSyncAt: cfg.lastSyncAt, active: cfg.active,
        }
      : null,
    settings: { ...DEFAULT_SETTINGS, ...(cfg?.settings ?? {}) },
    live: { ...live },
  });
}

export async function POST(req: NextRequest) {
  if (!rateLimit(`bot:${ip(req)}`, 10, 60_000)) return Response.json({ error: "Rate limit — tunggu sebentar." }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  if (action === "connect") {
    const token: string = (body.token ?? "").trim();
    if (!/^\d{6,}:[\w-]{25,}$/.test(token)) {
      return Response.json({ error: "❌ Token Bot tidak valid. Format: 123456789:ABCdef..." }, { status: 400 });
    }
    try {
      const me = await tg.getMe(token);
      if (!me.ok || !me.result) {
        return Response.json({ error: "❌ Token Bot tidak valid." }, { status: 400 });
      }
      const bot = me.result;
      let photoPath: string | null = null;
      try {
        const pp = await tg.getUserProfilePhotos(token, bot.id);
        const fid = pp?.result?.photos?.[0]?.[0]?.file_id;
        if (fid) {
          const f = await tg.getFile(token, fid);
          if (f.ok) photoPath = f.result.file_path;
        }
      } catch { /* foto profil opsional */ }
      let description: string | null = null;
      try {
        const d = await tg.getMyDescription(token);
        description = d?.result?.description ?? null;
      } catch { /* opsional */ }

      const prev = await getConfig();
      const cfg = await upsertConfig({
        tokenEnc: encrypt(token),
        botId: String(bot.id), botName: bot.first_name, botUsername: bot.username ?? null,
        botPhotoPath: photoPath, description,
        mode: "polling", webhookUrl: null, active: true,
        connectedAt: new Date(), lastSyncAt: new Date(),
        settings: prev?.settings ?? DEFAULT_SETTINGS,
      });
      await refreshConfig();
      await tg.deleteWebhook(token).catch(() => {});
      await ensureEngine();
      return Response.json({
        ok: true, message: "✅ Bot berhasil terhubung.",
        bot: {
          id: cfg?.botId, name: cfg?.botName, username: cfg?.botUsername, description,
          photoUrl: photoPath ? `/api/file?path=${encodeURIComponent(photoPath)}` : null,
          latency: me.latency, mode: "polling",
        },
      });
    } catch (e: any) {
      return Response.json({ error: "❌ Gagal menghubungi Telegram API. Periksa koneksi/token." }, { status: 502 });
    }
  }

  if (action === "disconnect") {
    const cfg = await getConfig();
    const token = getToken(cfg);
    stopEngine();
    if (token) await tg.deleteWebhook(token).catch(() => {});
    await upsertConfig({ active: false, mode: "polling", webhookUrl: null });
    await refreshConfig();
    return Response.json({ ok: true });
  }

  if (action === "mode") {
    const cfg = await getConfig();
    const token = getToken(cfg);
    if (!cfg || !token) return Response.json({ error: "Bot belum terhubung." }, { status: 400 });
    if (body.mode === "webhook") {
      const url: string = (body.url ?? "").trim();
      if (!/^https:\/\//.test(url)) return Response.json({ error: "❌ URL webhook harus https://..." }, { status: 400 });
      const r = await tg.setWebhook(token, url, WEBHOOK_SECRET);
      if (!r.ok) return Response.json({ error: `❌ Ganti webhook gagal: ${r.description}` }, { status: 502 });
      stopEngine();
      await upsertConfig({ mode: "webhook", webhookUrl: url });
      await refreshConfig();
      return Response.json({ ok: true, message: "✅ Webhook terpasang.", url });
    }
    // back to long polling
    await tg.deleteWebhook(token);
    await upsertConfig({ mode: "polling", webhookUrl: null });
    await refreshConfig();
    await ensureEngine();
    return Response.json({ ok: true, message: "✅ Long polling aktif." });
  }

  return Response.json({ error: "Aksi tidak dikenal." }, { status: 400 });
}
