import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  type WASocket,
} from "@whiskeysockets/baileys";
import P from "pino";
import QRCode from "qrcode";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";

const logger = P({ level: process.env.WA_LOG_LEVEL || "silent" });
const g = globalThis as any;
if (!g.__aksesbotmuSessions) {
  g.__aksesbotmuSessions = new Map<string, {
    waSocket?: WASocket;
    waStatus: {
      connected: boolean;
      connecting: boolean;
      phone?: string | null;
      jid?: string | null;
      qr?: string | null;
      qrDataUrl?: string | null;
      pairingCode?: string | null;
      lastError?: string | null;
    };
    tgPollingActive?: boolean;
    tgLastUpdateId?: number;
  }>();
}

const sessionsMap: Map<string, any> = g.__aksesbotmuSessions;
export const sessionBus = new EventEmitter();
sessionBus.setMaxListeners(200);

function getSessionStore(sessionId: string) {
  if (!sessionsMap.has(sessionId)) {
    sessionsMap.set(sessionId, {
      waStatus: { connected: false, connecting: false, phone: null, jid: null, qr: null, qrDataUrl: null, pairingCode: null, lastError: null },
      tgPollingActive: false,
      tgLastUpdateId: 0,
    });
  }
  return sessionsMap.get(sessionId);
}

function normalizePhone(value: string) {
  return String(value || "").replace(/[^\d]/g, "").replace(/^00/, "");
}

/* ==================== WHATSAPP BAILEYS 6.7.18 MULTI-SESSION ==================== */

const AUTH_ROOT = path.resolve(process.env.WA_AUTH_DIR || "./data/whatsapp-sessions");

export async function startWhatsAppSession(sessionId: string) {
  const store = getSessionStore(sessionId);
  if (store.waSocket) return store.waSocket as WASocket;

  const sessionAuthDir = path.join(AUTH_ROOT, sessionId);
  fs.mkdirSync(sessionAuthDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionAuthDir);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 0] as [number, number, number] }));

  store.waStatus.connecting = true;
  store.waStatus.lastError = null;

  const sock = makeWASocket({
    version,
    auth: state,
    browser: Browsers.ubuntu(`AKSESBOTMU-${sessionId}`),
    printQRInTerminal: false,
    logger,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (u) => {
    if (u.qr) {
      store.waStatus.qr = u.qr;
      store.waStatus.qrDataUrl = await QRCode.toDataURL(u.qr, { width: 320, margin: 2 });
      store.waStatus.pairingCode = null;
      sessionBus.emit(`wa-status:${sessionId}`, { ...store.waStatus });
    }

    if (u.connection === "open") {
      store.waStatus.connected = true;
      store.waStatus.connecting = false;
      store.waStatus.qr = null;
      store.waStatus.qrDataUrl = null;
      store.waStatus.pairingCode = null;
      store.waStatus.jid = sock.user?.id || null;
      store.waStatus.phone = sock.user?.id?.split(":")[0]?.split("@")[0] || null;
      sessionBus.emit(`wa-status:${sessionId}`, { ...store.waStatus });
    }

    if (u.connection === "close") {
      store.waStatus.connected = false;
      store.waStatus.connecting = false;
      const code = (u.lastDisconnect?.error as any)?.output?.statusCode;
      store.waStatus.lastError = u.lastDisconnect?.error?.message || `connection closed (${code ?? "unknown"})`;
      store.waSocket = undefined;

      if (code !== DisconnectReason.loggedOut && code !== DisconnectReason.forbidden) {
        setTimeout(() => startWhatsAppSession(sessionId).catch(() => {}), 3000);
      }
      sessionBus.emit(`wa-status:${sessionId}`, { ...store.waStatus });
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;
        const jid = msg.key.remoteJid;
        if (!jid || jid === "status@broadcast") continue;

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          msg.message.videoMessage?.caption ||
          "";

        if (!text.trim()) continue;
        await handleWhatsAppMessage(sock, jid, text.trim(), msg);
      } catch (e: any) {
        store.waStatus.lastError = e?.message || String(e);
        sessionBus.emit(`wa-status:${sessionId}`, { ...store.waStatus });
      }
    }
  });

  store.waSocket = sock;
  return sock;
}

export async function requestWAPairingCode(sessionId: string, phone: string) {
  const number = normalizePhone(phone);
  if (!/^\d{8,15}$/.test(number)) throw new Error("Nomor WhatsApp harus format internasional, contoh 628123456789.");

  const store = getSessionStore(sessionId);
  const sock = await startWhatsAppSession(sessionId);
  if (store.waStatus.connected) throw new Error("WhatsApp sudah terhubung.");

  await new Promise(res => setTimeout(res, 1500));
  const code = await sock.requestPairingCode(number);
  store.waStatus.phone = number;
  store.waStatus.pairingCode = code;
  store.waStatus.qr = null;
  store.waStatus.qrDataUrl = null;
  sessionBus.emit(`wa-status:${sessionId}`, { ...store.waStatus });
  return code;
}

export async function disconnectWASession(sessionId: string, logout = false) {
  const store = getSessionStore(sessionId);
  if (store.waSocket) {
    try {
      if (logout) await store.waSocket.logout();
      else store.waSocket.end(undefined);
    } catch {}
  }
  store.waSocket = undefined;
  store.waStatus.connected = false;
  store.waStatus.connecting = false;
  store.waStatus.qr = null;
  store.waStatus.qrDataUrl = null;
  store.waStatus.pairingCode = null;

  if (logout) {
    const sessionAuthDir = path.join(AUTH_ROOT, sessionId);
    fs.rmSync(sessionAuthDir, { recursive: true, force: true });
  }
  sessionBus.emit(`wa-status:${sessionId}`, { ...store.waStatus });
}

export function getWAStatus(sessionId: string) {
  const store = getSessionStore(sessionId);
  return { ...store.waStatus };
}

async function handleWhatsAppMessage(sock: WASocket, jid: string, text: string, msg: any) {
  const prefix = text.trim().startsWith("/") ? text.trim().slice(1).split(/\s+/) : [];
  const command = (prefix[0] || "").toLowerCase();
  const args = prefix.slice(1).join(" ").trim();

  if (command === "brat") {
    const { makeBratSticker } = await import("@/lib/sticker/brat");
    const webp = await makeBratSticker(args || "brat");
    await sock.sendMessage(jid, { sticker: webp });
    return;
  }

  if (command === "menu" || command === "start") {
    await sock.sendMessage(jid, {
      text:
        "⚡ AKSESBOTMU (Multi-Session Baileys 6.7.18)\n\n" +
        "🤖 AI Assistant\n" +
        "🖼️ /brat <teks> (Stiker)\n" +
        "🔎 /google <teks>\n" +
        "📚 /wiki <teks>\n" +
        "⛩️ /anime <judul>\n\n" +
        "Ketik perintah sesuai kebutuhan."
    });
    return;
  }

  if (command === "google") {
    await sock.sendMessage(jid, { text: `🔎 Pencarian Google:\nhttps://www.google.com/search?q=${encodeURIComponent(args)}` });
    return;
  }

  if (command === "wiki") {
    if (!args) return void sock.sendMessage(jid, { text: "❗ Contoh: /wiki Indonesia" });
    try {
      const r = await fetch(`https://id.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(args.replace(/ /g, "_"))}`, { signal: AbortSignal.timeout(9000) });
      const d: any = await r.json();
      await sock.sendMessage(jid, { text: `📚 ${d.title || args}\n\n${(d.extract || "").slice(0, 1500)}` });
    } catch {
      await sock.sendMessage(jid, { text: "❌ Wikipedia tidak tersedia." });
    }
    return;
  }

  if (command === "anime") {
    if (!args) return void sock.sendMessage(jid, { text: "❗ Contoh: /anime Naruto" });
    try {
      const r = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(args)}&limit=1&sfw=true`, { signal: AbortSignal.timeout(10000) });
      const d: any = await r.json();
      const a = d?.data?.[0];
      if (!a) return void sock.sendMessage(jid, { text: `❌ Anime tidak ditemukan.` });
      const cap = `⛩️ ${a.title}\n⭐ ${a.score ?? "-"} · ${a.episodes ?? "?"} eps\n\n${(a.synopsis || "").slice(0, 1000)}`;
      if (a.images?.jpg?.image_url) {
        await sock.sendMessage(jid, { image: { url: a.images.jpg.image_url }, caption: cap });
      } else {
        await sock.sendMessage(jid, { text: cap });
      }
    } catch {
      await sock.sendMessage(jid, { text: "❌ Gagal mencari anime." });
    }
    return;
  }

  if (!text.startsWith("/")) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY || ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text }] }] }),
        signal: AbortSignal.timeout(20000),
      });
      const d: any = await r.json();
      const out = d?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("").trim();
      if (out) await sock.sendMessage(jid, { text: out });
    } catch {}
  }
}

/* ==================== TELEGRAM MULTI-SESSION POLLING ==================== */

export async function startTelegramPollingForSession(sessionId: string, token: string) {
  const store = getSessionStore(sessionId);
  if (store.tgPollingActive) return;
  store.tgPollingActive = true;

  const loop = async () => {
    while (store.tgPollingActive) {
      try {
        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${store.tgLastUpdateId + 1}&timeout=25`;
        const res = await fetch(url, { signal: AbortSignal.timeout(35_000) });
        const data: any = await res.json();
        if (data.ok && Array.isArray(data.result)) {
          for (const upd of data.result) {
            store.tgLastUpdateId = upd.update_id;
            const msg = upd.message || upd.edited_message;
            if (msg && msg.text) {
              await handleTelegramMessage(token, msg.chat.id, msg.text, msg);
            }
          }
        }
      } catch {
        await new Promise(r => setTimeout(r, 4000));
      }
    }
  };

  loop().catch(() => {});
}

export function stopTelegramPollingForSession(sessionId: string) {
  const store = getSessionStore(sessionId);
  store.tgPollingActive = false;
}

async function handleTelegramMessage(token: string, chatId: number | string, text: string, msg: any) {
  const prefix = text.trim().startsWith("/") ? text.trim().slice(1).split(/\s+/) : [];
  const command = (prefix[0] || "").toLowerCase();
  const args = prefix.slice(1).join(" ").trim();

  const send = (t: string, extra = {}) =>
    fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: t, ...extra }),
    }).catch(() => {});

  if (command === "start" || command === "menu") {
    await send(
      "⚡ AKSESBOTMU Telegram Bot (Multi-Session)\n\n" +
      "🤖 AI Chat\n" +
      "🔎 /google <teks>\n" +
      "📚 /wiki <teks>\n" +
      "⛩️ /anime <judul>\n\n" +
      "Ketik pesan atau perintah untuk mulai."
    );
    return;
  }

  if (command === "google") {
    await send(`🔎 Hasil pencarian:\nhttps://www.google.com/search?q=${encodeURIComponent(args)}`);
    return;
  }

  if (command === "wiki") {
    if (!args) return void send("❗ Contoh: /wiki Indonesia");
    try {
      const r = await fetch(`https://id.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(args.replace(/ /g, "_"))}`, { signal: AbortSignal.timeout(9000) });
      const d: any = await r.json();
      await send(`📚 ${d.title || args}\n\n${(d.extract || "").slice(0, 1500)}`);
    } catch {
      await send("❌ Wikipedia tidak tersedia.");
    }
    return;
  }

  if (command === "anime") {
    if (!args) return void send("❗ Contoh: /anime Naruto");
    try {
      const r = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(args)}&limit=1&sfw=true`, { signal: AbortSignal.timeout(10000) });
      const d: any = await r.json();
      const a = d?.data?.[0];
      if (!a) return void send("❌ Anime tidak ditemukan.");
      const cap = `⛩️ ${a.title}\n⭐ ${a.score ?? "-"} · ${a.episodes ?? "?"} eps\n\n${(a.synopsis || "").slice(0, 1000)}`;
      if (a.images?.jpg?.image_url) {
        await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, photo: a.images.jpg.image_url, caption: cap }),
        });
      } else {
        await send(cap);
      }
    } catch {
      await send("❌ Gagal mencari anime.");
    }
    return;
  }

  if (!text.startsWith("/")) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY || ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text }] }] }),
        signal: AbortSignal.timeout(20000),
      });
      const d: any = await r.json();
      const out = d?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("").trim();
      if (out) await send(out);
    } catch {}
  }
}
