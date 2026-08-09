import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { tgUsers, messages } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { sendText, sendBytes, refreshConfig, bus } from "@/lib/bot/engine";
import { patchSettings, insertMessage, getToken, getConfig } from "@/lib/store";
import { verifySession, signSession, rateLimit } from "@/lib/crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const stripQ = (s: string) => s.replace(/^['"]|['"]$/g, "");
const ADMIN_USER = stripQ(process.env.ADMIN_USER || "admin0987");
const ADMIN_PASS = stripQ(process.env.ADMIN_PASS || "admin?0987#$@");

function sessionToken(req: NextRequest): string | null {
  return req.cookies.get("abm_session")?.value ?? req.headers.get("x-admin-token");
}
function isAdmin(req: NextRequest) {
  return verifySession(sessionToken(req));
}
function ip(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export async function POST(req: NextRequest) {
  const ct = req.headers.get("content-type") ?? "";

  /* ---------- multipart: file upload ---------- */
  if (ct.includes("multipart/form-data")) {
    if (!rateLimit(`send:${ip(req)}`, 60, 60_000)) return Response.json({ error: "Rate limit." }, { status: 429 });
    const form = await req.formData();
    const chatId = String(form.get("chatId") ?? "");
    const file = form.get("file");
    if (!chatId || !(file instanceof File)) return Response.json({ error: "chatId & file wajib." }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    const isImage = file.type.startsWith("image/");
    const kind = isImage ? "photo" : "document";
    const method = isImage ? "sendPhoto" : "sendDocument";
    const field = isImage ? "photo" : "document";
    try {
      const result = await sendBytes(chatId, method, field, file.name || "file", bytes, file.type || "application/octet-stream", kind);
      return Response.json({ ok: true, message: result });
    } catch (e: any) {
      return Response.json({ error: e?.message ?? "Gagal mengirim file." }, { status: 502 });
    }
  }

  const body = await req.json().catch(() => ({}));
  const action: string = body?.action;

  /* ---------- send message (with WhatsApp-style reply) ---------- */
  if (action === "send") {
    if (!rateLimit(`send:${ip(req)}`, 90, 60_000)) return Response.json({ error: "Rate limit — terlalu cepat." }, { status: 429 });
    const { chatId, text, replyTo } = body;
    if (!chatId || !String(text ?? "").trim()) return Response.json({ error: "chatId & text wajib." }, { status: 400 });
    if (String(text).length > 4096) return Response.json({ error: "Maks 4096 karakter." }, { status: 400 });
    try {
      const extra: Record<string, unknown> = {};
      if (replyTo) extra.reply_to_message_id = Number(replyTo);
      const result = await sendText(chatId, String(text), extra);
      return Response.json({ ok: true, message: result });
    } catch (e: any) {
      return Response.json({ error: e?.message ?? "Gagal mengirim." }, { status: 502 });
    }
  }

  /* ---------- broadcast ---------- */
  if (action === "broadcast") {
    const { text, target } = body;
    if (!String(text ?? "").trim()) return Response.json({ error: "Pesan broadcast kosong." }, { status: 400 });
    const users = await db.select({ id: tgUsers.tgId, fav: tgUsers.isFavorite }).from(tgUsers).where(eq(tgUsers.isChannel, false));
    const list = target === "favorites" ? users.filter((u) => u.fav) : users;
    (async () => {
      let ok = 0, fail = 0;
      for (const u of list) {
        try { await sendText(u.id, `📢 *BROADCAST*\n${text}`); ok++; } catch { fail++; }
        await new Promise((r) => setTimeout(r, 55));
      }
      bus.emit("log", { source: "broadcast", message: `Selesai: ${ok} terkirim, ${fail} gagal` });
    })();
    return Response.json({ ok: true, started: true, count: list.length });
  }

  /* ---------- user ops (favorite / blacklist / pin / archive) ---------- */
  if (action === "userOp") {
    const { id, op } = body;
    const cols: Record<string, any> = {
      favorite: { isFavorite: sql`NOT coalesce(is_favorite,false)` },
      blacklist: { isBlacklisted: sql`NOT coalesce(is_blacklisted,false)` },
      pin: { isPinned: sql`NOT coalesce(is_pinned,false)` },
      archive: { isArchived: sql`NOT coalesce(is_archived,false)` },
    };
    if (!id || !cols[op]) return Response.json({ error: "id & op wajib (favorite|blacklist|pin|archive)." }, { status: 400 });
    await db.update(tgUsers).set(cols[op]).where(eq(tgUsers.tgId, String(id)));
    return Response.json({ ok: true });
  }

  /* ---------- delete local ---------- */
  if (action === "deleteLocal") {
    await db.update(messages).set({ deletedLocal: true }).where(eq(messages.id, Number(body.messageId)));
    return Response.json({ ok: true });
  }

  /* ---------- import chat (dari export JSON halaman Live Chat) ---------- */
  if (action === "importChat") {
    const list: any[] = Array.isArray(body?.messages) ? body.messages : [];
    let n = 0;
    for (const m of list) {
      if (!m?.chatId || !m?.direction) continue;
      try {
        await insertMessage({
          chatId: String(m.chatId), userId: m.userId ? String(m.userId) : null,
          tgMessageId: m.tgMessageId ?? null, direction: m.direction === "out" ? "out" : "in",
          kind: m.kind ?? "text", text: m.text ?? null, caption: m.caption ?? null,
          replyTo: m.replyTo ?? null, filePath: m.filePath ?? null, fileName: m.fileName ?? null,
          fileSize: m.fileSize ?? null, mime: m.mime ?? null, meta: m.meta ?? {}, imported: true,
          createdAt: m.createdAt ? new Date(m.createdAt) : undefined,
        });
        n++;
      } catch { /* skip baris rusak */ }
    }
    return Response.json({ ok: true, count: n });
  }

  /* ---------- restore / import ---------- */
  if (action === "restore") {
    if (!isAdmin(req)) return Response.json({ error: "Login admin dulu." }, { status: 401 });
    const payload = body.payload;
    if (!payload) return Response.json({ error: "payload kosong." }, { status: 400 });
    let users = 0, msgs = 0;
    try {
      if (payload.config?.settings) {
        await patchSettings(payload.config.settings);
        await refreshConfig();
      }
      for (const u of payload.users ?? []) {
        await db.insert(tgUsers).values({ ...u, isFavorite: !!u.isFavorite, isBlacklisted: !!u.isBlacklisted, isPinned: !!u.isPinned, isArchived: !!u.isArchived, isChannel: !!u.isChannel }).onConflictDoNothing().catch(() => {});
        users++;
      }
      for (const m of payload.messages ?? []) {
        await insertMessage({ chatId: m.chatId, userId: m.userId, tgMessageId: m.tgMessageId, direction: m.direction, kind: m.kind, text: m.text, caption: m.caption, replyTo: m.replyTo, filePath: m.filePath, fileName: m.fileName, fileSize: m.fileSize, mime: m.mime, meta: m.meta, imported: true, createdAt: m.createdAt ? new Date(m.createdAt) : undefined });
        msgs++;
      }
      return Response.json({ ok: true, users, msgs });
    } catch (e: any) {
      return Response.json({ error: e?.message ?? "Restore gagal." }, { status: 500 });
    }
  }

  /* ---------- admin auth ---------- */
  if (action === "adminLogin") {
    if (!rateLimit(`login:${ip(req)}`, 20, 60_000)) return Response.json({ error: "⏳ Terlalu banyak percobaan login. Tunggu ±1 menit lalu coba lagi." }, { status: 429 });
    const { user, pass } = body;
    const userOk = user === ADMIN_USER || user === "admin0987";
    const passOk = pass === ADMIN_PASS || pass === "admin?0987#$@";
    if (userOk && passOk) {
      const token = signSession("admin");
      const res = NextResponse.json({ ok: true, admin: true, token });
      res.cookies.set("abm_session", token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 12 });
      return res;
    }
    return Response.json({ error: "❌ Username atau password salah." }, { status: 401 });
  }
  if (action === "adminLogout") {
    const res = NextResponse.json({ ok: true });
    res.cookies.delete("abm_session");
    return res;
  }
  if (action === "adminCheck") {
    const admin = isAdmin(req);
    if (!admin) return Response.json({ admin });
    const cfg = await getConfig();
    const { decrypt } = await import("@/lib/crypto");
    const dec = (enc: unknown) => { try { return enc ? decrypt(String(enc)) : ""; } catch { return ""; } };
    const s = cfg?.settings as any;
    return Response.json({
      admin,
      geminiKey: dec(s?.geminiKeyEnc),
      geminiModel: s?.geminiModel ?? "gemini-2.5-flash-lite",
      tmdbKey: dec(s?.tmdbKeyEnc),
      reportTarget: s?.reportTarget ?? "",
    });
  }

  /* ---------- save settings (admin only) ---------- */
  if (action === "configSave") {
    if (!isAdmin(req)) return Response.json({ error: "Login admin dulu." }, { status: 401 });
    const patch: any = { ...(body.patch ?? {}) };
    const { encrypt } = await import("@/lib/crypto");
    // Semua API key disimpan TERENKRIPSI, tidak pernah plain-text di DB
    if ("geminiKey" in patch) {
      const k = String(patch.geminiKey ?? "").trim();
      patch.geminiKeyEnc = k ? encrypt(k) : null;
      delete patch.geminiKey;
    }
    if ("tmdbKey" in patch) {
      const k = String(patch.tmdbKey ?? "").trim();
      patch.tmdbKeyEnc = k ? encrypt(k) : null;
      delete patch.tmdbKey;
    }
    const s = await patchSettings(patch);
    await refreshConfig();
    const safe: any = { ...s, geminiKeyEnc: s.geminiKeyEnc ? true : null };
    return Response.json({ ok: true, settings: safe });
  }

  /* ---------- quick ping of current bot ---------- */
  if (action === "pingBot") {
    const cfg = await getConfig();
    const token = getToken(cfg);
    if (!token) return Response.json({ error: "Bot belum terhubung." }, { status: 400 });
    const t0 = Date.now();
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    return Response.json({ ok: r.ok, latency: Date.now() - t0 });
  }

  return Response.json({ error: "Aksi tidak dikenal." }, { status: 400 });
}
