import { NextRequest } from "next/server";
import { db } from "@/db";
import { tgUsers, messages, errorLogs } from "@/db/schema";
import { eq, desc, and, lt, sql } from "drizzle-orm";
import { getStats, fullBackup, getConfig, DEFAULT_SETTINGS } from "@/lib/store";
import { live } from "@/lib/bot/engine";
import { verifySession } from "@/lib/crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type") ?? "boot";

  if (type === "boot") {
    const cfg = await getConfig();
    const admin = verifySession(req.cookies.get("abm_session")?.value);
    const settings: any = { ...DEFAULT_SETTINGS, ...(cfg?.settings ?? {}) };
    const hasGeminiKey = !!settings.geminiKeyEnc;
    const hasTmdbKey = !!settings.tmdbKeyEnc;
    delete settings.geminiKeyEnc; // jangan pernah bocor ke client — hanya flag
    delete settings.tmdbKeyEnc;
    return Response.json({
      connected: !!(cfg?.active && cfg?.tokenEnc),
      bot: cfg ? {
        id: cfg.botId, name: cfg.botName, username: cfg.botUsername, description: cfg.description,
        mode: cfg.mode ?? "polling", webhookUrl: cfg.webhookUrl,
        photoUrl: cfg.botPhotoPath ? `/api/file?path=${encodeURIComponent(cfg.botPhotoPath)}` : null,
        connectedAt: cfg.connectedAt, lastSyncAt: cfg.lastSyncAt, active: cfg.active,
      } : null,
      settings: { ...settings, hasGeminiKey, hasTmdbKey },
      live: { ...live },
      admin,
    });
  }

  if (type === "stats") {
    const stats = await getStats();
    return Response.json({ ...stats, live: { ...live } });
  }

  if (type === "chats") {
    const res = await db.execute(sql`
      SELECT DISTINCT ON (m.chat_id) m.chat_id, m.text, m.caption, m.kind, m.direction, m.created_at,
        u.first_name, u.username, u.photo_path, u.is_favorite, u.is_blacklisted, u.is_pinned, u.is_archived, u.is_channel,
        (SELECT count(*)::int FROM messages m2 WHERE m2.chat_id = m.chat_id) AS total
      FROM messages m LEFT JOIN tg_users u ON u.tg_id = m.chat_id
      WHERE m.deleted_local = false
      ORDER BY m.chat_id, m.id DESC`);
    const rows = ((res as any).rows ?? []).sort((a: any, b: any) => +new Date(b.created_at) - +new Date(a.created_at));
    const pinned = rows.filter((r: any) => r.is_pinned);
    const rest = rows.filter((r: any) => !r.is_pinned);
    return Response.json({ chats: [...pinned, ...rest] });
  }

  if (type === "messages") {
    const chatId = req.nextUrl.searchParams.get("chatId");
    if (!chatId) return Response.json({ error: "chatId required" }, { status: 400 });
    const before = req.nextUrl.searchParams.get("before");
    const conds = [eq(messages.chatId, chatId), eq(messages.deletedLocal, false)];
    if (before) conds.push(lt(messages.id, Number(before)));
    const rows = await db.select().from(messages).where(and(...conds)).orderBy(desc(messages.id)).limit(60);
    return Response.json({ messages: rows.reverse() });
  }

  if (type === "users") {
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
    const rows = q
      ? await db.select().from(tgUsers)
          .where(sql`lower(coalesce(first_name,'')) like ${"%" + q + "%"} or lower(coalesce(username,'')) like ${"%" + q + "%"} or tg_id like ${"%" + q + "%"}`)
          .orderBy(desc(tgUsers.lastSeen)).limit(200)
      : await db.select().from(tgUsers).orderBy(desc(tgUsers.lastSeen)).limit(200);
    return Response.json({ users: rows });
  }

  if (type === "user") {
    const id = req.nextUrl.searchParams.get("id") ?? "";
    const [u] = await db.select().from(tgUsers).where(eq(tgUsers.tgId, id)).limit(1);
    const [cnt] = await db.select({ n: sql<number>`count(*)::int` }).from(messages).where(eq(messages.chatId, id));
    return Response.json({ user: u ?? null, totalMessages: Number(cnt?.n ?? 0) });
  }

  if (type === "logs") {
    const rows = await db.select().from(errorLogs).orderBy(desc(errorLogs.id)).limit(30);
    return Response.json({ logs: rows });
  }

  if (type === "backup") {
    const data = await fullBackup();
    return new Response(JSON.stringify(data, null, 2), {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="aksesbotmu-backup-${Date.now()}.json"` },
    });
  }

  return Response.json({ error: "type tidak dikenal" }, { status: 400 });
}
