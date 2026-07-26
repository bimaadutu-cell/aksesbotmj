import { EventEmitter } from "events";
import { tg } from "@/lib/telegram";
import { getConfig, getToken, upsertConfig, upsertTgUser, insertMessage, bumpUserCounter, logError, type ConfigRow } from "@/lib/store";
import { dispatchCommand, dispatchCallback, maybeAutoReply, enforceGroupRules, consumeNewBotWizard } from "@/lib/bot/commands";
import { db } from "@/db";
import { tgUsers } from "@/db/schema";
import { eq } from "drizzle-orm";

export const bus = new EventEmitter();
bus.setMaxListeners(200);

export interface LiveStats {
  startedAt: number | null;
  processed: number;
  lastBatch: number;
  latencyMs: number;
  apiOnline: boolean;
  lastPingAt: number;
  latencyHistory: number[];
}

export const live: LiveStats = { startedAt: null, processed: 0, lastBatch: 0, latencyMs: 0, apiOnline: false, lastPingAt: 0, latencyHistory: [] };

const g = globalThis as any;

let cfgCache: ConfigRow | null | undefined;
let cfgAt = 0;

export async function currentConfig(force = false): Promise<ConfigRow | null> {
  if (!force && cfgCache !== undefined && Date.now() - cfgAt < 15_000) return cfgCache;
  try {
    cfgCache = await getConfig();
    cfgAt = Date.now();
  } catch { cfgCache = cfgCache ?? null; }
  return cfgCache;
}

export async function refreshConfig() {
  cfgCache = await getConfig();
  cfgAt = Date.now();
  return cfgCache;
}

export async function currentToken(): Promise<string | null> {
  const c = await currentConfig();
  return getToken(c);
}

/* ---------------- send helpers (persist + broadcast to UI) ---------------- */

export async function sendText(chatId: string, text: string, extra: Record<string, unknown> = {}): Promise<any> {
  const token = await currentToken();
  if (!token) throw new Error("Bot belum terhubung");
  const r = await tg.sendMessage(token, chatId, text, extra);
  if (!r.ok) {
    await logError("sendMessage", r.description ?? "send failed", { chatId });
    throw new Error(r.description ?? "Telegram error");
  }
  const row = await insertMessage({
    chatId, userId: chatId, tgMessageId: r.result?.message_id, direction: "out", kind: "text",
    text, replyTo: (extra as any).reply_to_message_id ?? null, meta: { via: "dashboard" },
  });
  if (row) bus.emit("message", row);
  emitStatsSoon();
  return r.result;
}

export async function sendPhotoUrl(chatId: string, photo: string, caption?: string, extra: Record<string, unknown> = {}) {
  const token = await currentToken();
  if (!token) throw new Error("Bot belum terhubung");
  const r = await tg.sendPhoto(token, chatId, photo, caption, extra);
  if (!r.ok) {
    await logError("sendPhoto", r.description ?? "send failed", { chatId });
    throw new Error(r.description ?? "Telegram error");
  }
  const row = await insertMessage({
    chatId, userId: chatId, tgMessageId: r.result?.message_id, direction: "out", kind: "photo",
    caption: caption ?? null, text: caption ?? null, filePath: typeof photo === "string" && photo.startsWith("http") ? photo : null,
    meta: { via: "dashboard" },
  });
  if (row) bus.emit("message", row);
  return r.result;
}

export async function sendBytes(chatId: string, method: string, fileField: string, fileName: string, bytes: Buffer, mime: string, kind: string, caption?: string) {
  const token = await currentToken();
  if (!token) throw new Error("Bot belum terhubung");
  const r = await tg.sendFile(token, method, { chat_id: chatId, ...(caption ? { caption } : {}) }, fileField, fileName, bytes, mime);
  if (!r.ok) {
    await logError(method, r.description ?? "upload failed", { chatId });
    throw new Error(r.description ?? "Telegram upload error");
  }
  const row = await insertMessage({
    chatId, userId: chatId, tgMessageId: r.result?.message_id, direction: "out", kind,
    caption: caption ?? null, text: caption ?? null, fileName, fileSize: bytes.length, mime, meta: { via: "dashboard" },
  });
  if (row) bus.emit("message", row);
  return r.result;
}

export async function typing(chatId: string, action = "typing") {
  const token = await currentToken();
  if (token) await tg.sendChatAction(token, chatId, action);
}

/* ---------------- update processing ---------------- */

export async function persistIncoming(msg: any, kindOverride?: string) {
  const chatId = String(msg.chat.id);
  const from = msg.from ?? { id: msg.chat.id, first_name: msg.chat.title ?? msg.chat.first_name ?? "Unknown", username: msg.chat.username };
  await upsertTgUser(from);
  if (msg.chat.type === "private") await upsertTgUser({ id: msg.chat.id, first_name: msg.chat.first_name, last_name: msg.chat.last_name, username: msg.chat.username, type: "private" });

  let kind = kindOverride ?? "text";
  let text: string | null = msg.text ?? null;
  let filePath: string | null = null;
  let fileSize: number | null = null;
  let fileName: string | null = null;
  let mime: string | null = null;
  const meta: Record<string, unknown> = { chatType: msg.chat.type };

  const token = await currentToken();
  const resolveFile = async (fileId?: string) => {
    if (!fileId || !token) return;
    try {
      const f = await tg.getFile(token, fileId);
      if (f.ok) { filePath = f.result.file_path; fileSize = f.result.file_size ?? null; }
    } catch { /* file too large */ }
  };

  if (msg.photo?.length) {
    kind = "photo";
    const best = msg.photo[msg.photo.length - 1];
    await resolveFile(best.file_id);
    meta.width = best.width; meta.height = best.height;
  } else if (msg.sticker) {
    kind = msg.sticker.is_animated || msg.sticker.is_video ? "gif" : "sticker";
    await resolveFile(msg.sticker.file_id);
    meta.emoji = msg.sticker.emoji;
  } else if (msg.voice) { kind = "voice"; await resolveFile(msg.voice.file_id); mime = msg.voice.mime_type; meta.duration = msg.voice.duration; }
  else if (msg.video_note) { kind = "voice"; await resolveFile(msg.video_note.file_id); meta.duration = msg.video_note.duration; meta.videoNote = true; }
  else if (msg.audio) { kind = "audio"; await resolveFile(msg.audio.file_id); mime = msg.audio.mime_type; fileName = msg.audio.file_name ?? `${msg.audio.title ?? "audio"}.mp3`; meta.title = msg.audio.title; meta.performer = msg.audio.performer; meta.duration = msg.audio.duration; }
  else if (msg.video) { kind = "video"; await resolveFile(msg.video.file_id); mime = msg.video.mime_type; meta.duration = msg.video.duration; }
  else if (msg.animation) { kind = "gif"; await resolveFile(msg.animation.file_id); mime = msg.animation.mime_type; }
  else if (msg.document) { kind = "document"; await resolveFile(msg.document.file_id); mime = msg.document.mime_type; fileName = msg.document.file_name; }
  else if (msg.location) { kind = "location"; meta.lat = msg.location.latitude; meta.lng = msg.location.longitude; text = `📍 Lokasi: ${msg.location.latitude}, ${msg.location.longitude}`; }
  else if (msg.contact) { kind = "contact"; meta.phone = msg.contact.phone_number; meta.contactName = msg.contact.first_name; text = `📇 Kontak: ${msg.contact.first_name} — ${msg.contact.phone_number}`; }
  else if (msg.poll) { kind = "poll"; meta.poll = { question: msg.poll.question, options: msg.poll.options }; text = `📊 Poll: ${msg.poll.question}`; }

  if (msg.caption && !text) text = msg.caption;

  const row = await insertMessage({
    chatId, userId: String(from.id), tgMessageId: msg.message_id, direction: "in", kind,
    text, caption: msg.caption ?? null, replyTo: msg.reply_to_message?.message_id ?? null,
    filePath, fileName, fileSize, mime, meta,
    createdAt: msg.date ? new Date(msg.date * 1000) : new Date(),
  });
  await bumpUserCounter(String(from.id), "in", kind === "text" ? 2 : 1);
  if (row) bus.emit("message", row);
  emitStatsSoon();
  return { row, from, chatId };
}

async function processMessage(msg: any) {
  const cfg = await currentConfig();
  const token = getToken(cfg);
  if (!cfg || !token) return;

  const { from, chatId } = await persistIncoming(msg);
  const settings = cfg.settings ?? {};
  const userId = String(from.id);

  // welcome / leave events in groups
  const mods = (settings as any).groupMods?.[chatId];
  if (msg.new_chat_members?.length && mods?.welcome) {
    const names = msg.new_chat_members.map((m: any) => m.first_name).join(", ");
    await sendText(chatId, `👋 Selamat datang ${names}! Semoga betah di sini.`).catch(() => {});
  }
  if (msg.left_chat_member && mods?.welcome) {
    await sendText(chatId, `👋 Sampai jumpa ${msg.left_chat_member.first_name}.`).catch(() => {});
  }

  // blacklist check (settings + per-user flag)
  const [urow] = await db.select({ bl: tgUsers.isBlacklisted }).from(tgUsers).where(eq(tgUsers.tgId, userId)).limit(1);
  if (settings.blockedUsers?.includes(userId) || urow?.bl) return;

  // group moderation (antilink / antiflood / antibot)
  if (await enforceGroupRules({ token, cfg, msg, chatId, userId, from })) return;

  const text: string = (msg.text ?? msg.caption ?? "").trim();
  const isCommand = text.startsWith("/");

  if (isCommand) {
    await dispatchCommand({ token, cfg, msg, chatId, userId, text, from });
    return;
  }

  // wizard /newbot (pembuatan bot baru ala BotFather) punya prioritas sebelum quick reply/AI
  if (await consumeNewBotWizard({ token, cfg, msg, chatId, userId, text, from })) return;

  // quick replies
  const qr = (settings.quickReplies ?? []).find((q) => q.trigger && text.toLowerCase().includes(q.trigger.toLowerCase()));
  if (qr) {
    await sendText(chatId, qr.response, { reply_to_message_id: msg.message_id });
    return;
  }

  await maybeAutoReply({ token, cfg, msg, chatId, userId, text, from });
}

export async function handleUpdate(update: any) {
  live.processed++;
  try {
    if (update.message) await processMessage(update.message);
    else if (update.edited_message) await processMessage(update.edited_message);
    else if (update.callback_query) {
      const cb = update.callback_query;
      const cfg = await currentConfig();
      const token = getToken(cfg);
      if (cfg && token) await dispatchCallback({ token, cfg, cb });
    } else if (update.my_chat_member) {
      const st = update.my_chat_member?.new_chat_member?.status;
      bus.emit("status", { event: "chat_member", status: st, at: Date.now() });
    }
  } catch (e: any) {
    await logError("engine", e?.message ?? String(e), e?.stack);
    bus.emit("log", { source: "engine", message: e?.message ?? String(e) });
  }
}

/* ---------------- polling loop ---------------- */

let offset = 0;
let loopRunning = false;

async function loop() {
  if (g.__abmLoop) return;
  g.__abmLoop = true;
  loopRunning = true;
  live.startedAt = Date.now();
  bus.emit("status", { event: "engine_start", at: Date.now() });

  while (loopRunning) {
    const cfg = await currentConfig();
    const token = getToken(cfg);
    if (!cfg?.active || cfg.mode !== "polling" || !token) {
      loopRunning = false;
      break;
    }
    try {
      const t0 = Date.now();
      const r = await tg.getUpdates(token, offset);
      live.latencyMs = Math.min(999, Date.now() - t0 - 24_500 > 0 ? 40 : Date.now() - t0);
      live.apiOnline = r.ok;
      live.lastPingAt = Date.now();
      if (!r.ok) {
        await logError("getUpdates", r.description ?? "poll failed");
        if (r.error_code === 401 || r.error_code === 404) { await upsertConfig({ active: false }); await refreshConfig(); break; }
        await sleep(2500);
        continue;
      }
      const updates = r.result ?? [];
      live.lastBatch = updates.length;
      await upsertConfig({ lastSyncAt: new Date() }).catch(() => {});
      for (const u of updates) {
        offset = u.update_id + 1;
        await handleUpdate(u);
      }
      if (updates.length) emitStatsSoon();
    } catch (e: any) {
      live.apiOnline = false;
      await logError("polling", e?.message ?? String(e));
      await sleep(3000);
    }
  }
  g.__abmLoop = false;
  bus.emit("status", { event: "engine_stop", at: Date.now() });
}

export function stopEngine() {
  loopRunning = false;
  g.__abmLoop = false;
}

export async function ensureEngine() {
  try {
    const cfg = await refreshConfig();
    const token = getToken(cfg);
    if (!cfg?.active || cfg.mode !== "polling" || !token) return false;
    if (!loopRunning && !g.__abmLoop) void loop();
    return true;
  } catch {
    return false;
  }
}

/* periodic API ping (20s) — riwayat latency untuk grafik realtime di dashboard */
setInterval(async () => {
  try {
    const cfg = await currentConfig();
    const token = getToken(cfg);
    if (!cfg?.active || !token) return;
    const t0 = Date.now();
    const r = await tg.getMe(token);
    live.latencyMs = Date.now() - t0;
    live.apiOnline = r.ok;
    live.lastPingAt = Date.now();
    if (r.ok) live.latencyHistory = [...live.latencyHistory.slice(-59), live.latencyMs];
    emitStatsSoon();
  } catch { live.apiOnline = false; }
}, 20_000);

let statsTimer: ReturnType<typeof setTimeout> | null = null;
export function emitStatsSoon() {
  if (statsTimer) return;
  statsTimer = setTimeout(() => {
    statsTimer = null;
    bus.emit("stats", { at: Date.now() });
  }, 400);
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

/* Watchdog: pastikan engine selalu hidup 24/7 selama bot aktif (auto-restart bila mati) */
setInterval(() => { ensureEngine().catch(() => {}); }, 45_000);
