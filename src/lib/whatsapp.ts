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

export type WhatsAppStatus = {
  connected: boolean;
  connecting: boolean;
  phone?: string | null;
  jid?: string | null;
  qr?: string | null;
  qrDataUrl?: string | null;
  pairingCode?: string | null;
  lastError?: string | null;
};

const status: WhatsAppStatus = {
  connected: false,
  connecting: false,
  phone: null,
  jid: null,
  qr: null,
  qrDataUrl: null,
  pairingCode: null,
  lastError: null,
};

export const waBus = new EventEmitter();
waBus.setMaxListeners(100);

const g = globalThis as any;
const AUTH_DIR = path.resolve(process.env.WA_AUTH_DIR || "./data/whatsapp-auth");

function normalizePhone(value: string) {
  return String(value || "").replace(/[^\d]/g, "").replace(/^00/, "");
}

async function startWhatsApp() {
  if (g.__aksesbotmuWaSocket) return g.__aksesbotmuWaSocket as WASocket;

  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 0] as [number, number, number] }));

  status.connecting = true;
  status.lastError = null;
  const sock = makeWASocket({
    version,
    auth: state,
    browser: Browsers.ubuntu("AKSESBOTMU"),
    printQRInTerminal: false,
    logger,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (u) => {
    if (u.qr) {
      status.qr = u.qr;
      status.qrDataUrl = await QRCode.toDataURL(u.qr, { width: 320, margin: 2 });
      status.pairingCode = null;
      waBus.emit("status", { ...status });
    }

    if (u.connection === "open") {
      status.connected = true;
      status.connecting = false;
      status.qr = null;
      status.qrDataUrl = null;
      status.pairingCode = null;
      status.jid = sock.user?.id || null;
      status.phone = sock.user?.id?.split(":")[0]?.split("@")[0] || null;
      waBus.emit("status", { ...status });
    }

    if (u.connection === "close") {
      status.connected = false;
      status.connecting = false;
      const code = (u.lastDisconnect?.error as any)?.output?.statusCode;
      status.lastError = u.lastDisconnect?.error?.message || `connection closed (${code ?? "unknown"})`;
      g.__aksesbotmuWaSocket = null;

      if (code !== DisconnectReason.loggedOut && code !== DisconnectReason.forbidden) {
        setTimeout(() => startWhatsApp().catch(() => {}), 3000);
      }
      waBus.emit("status", { ...status });
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
        await handleWhatsAppText(sock, jid, text.trim(), msg);
      } catch (e: any) {
        status.lastError = e?.message || String(e);
        waBus.emit("status", { ...status });
      }
    }
  });

  g.__aksesbotmuWaSocket = sock;
  return sock;
}

async function handleWhatsAppText(sock: WASocket, jid: string, text: string, msg: any) {
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
        "⚡ AKSESBOTMU (Baileys 6.7.18)\n\n" +
        "🤖 AI — chat & bantuan\n" +
        "🖼️ Stiker — /brat <teks>\n" +
        "🔎 Search — /google <teks>\n" +
        "📚 Wiki — /wiki <teks>\n" +
        "⛩️ Anime — /anime <judul>\n\n" +
        "Ketik /help untuk bantuan."
    });
    return;
  }

  if (command === "google") {
    const q = encodeURIComponent(args);
    await sock.sendMessage(jid, { text: `🔎 Hasil pencarian:\nhttps://www.google.com/search?q=${q}` });
    return;
  }

  if (command === "wiki") {
    if (!args) return void sock.sendMessage(jid, { text: "❗ Contoh: /wiki Indonesia" });
    const slug = encodeURIComponent(args.replace(/ /g, "_"));
    try {
      const r = await fetch(`https://id.wikipedia.org/api/rest_v1/page/summary/${slug}`, { signal: AbortSignal.timeout(9000) });
      const d: any = await r.json();
      await sock.sendMessage(jid, { text: `📚 ${d.title || args}\n\n${(d.extract || d.description || "Tidak ditemukan.").slice(0, 1800)}` });
    } catch {
      await sock.sendMessage(jid, { text: "❌ Wikipedia sedang tidak tersedia." });
    }
    return;
  }

  if (command === "anime") {
    if (!args) return void sock.sendMessage(jid, { text: "❗ Contoh: /anime Naruto" });
    try {
      const r = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(args)}&limit=1&sfw=true`, { signal: AbortSignal.timeout(10000) });
      const d: any = await r.json();
      const a = d?.data?.[0];
      if (!a) return void sock.sendMessage(jid, { text: `❌ Anime "${args}" tidak ditemukan.` });
      const cap = `⛩️ ${a.title}\n⭐ ${a.score ?? "-"} · ${a.episodes ?? "?"} episode · ${a.status}\n\n${(a.synopsis || "Belum ada sinopsis.").slice(0, 1200)}`;
      if (a.images?.jpg?.image_url) {
        await sock.sendMessage(jid, { image: { url: a.images.jpg.image_url }, caption: cap });
      } else {
        await sock.sendMessage(jid, { text: cap });
      }
    } catch {
      await sock.sendMessage(jid, { text: "❌ Gagal mencari anime, coba lagi." });
    }
    return;
  }

  if (text.startsWith("/") && !command) return;
  if (!text.startsWith("/")) {
    const { resolveGeminiKey } = await import("@/lib/bot/commands");
    const { getConfig } = await import("@/lib/store");
    const cfg = await getConfig();
    const key = resolveGeminiKey(cfg?.settings || {});
    if (key) {
      try {
        const model = cfg?.settings?.geminiModel || "gemini-2.5-flash";
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 1600 } }),
          signal: AbortSignal.timeout(25000),
        });
        const d: any = await r.json();
        const out = d?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("").trim();
        if (out) await sock.sendMessage(jid, { text: out });
      } catch {
        await sock.sendMessage(jid, { text: "❌ AI sedang tidak tersedia." });
      }
    }
  }

  waBus.emit("message", { platform: "whatsapp", chatId: jid, text, id: msg.key.id, fromMe: false, timestamp: Date.now() });
}

export async function connectWhatsApp() {
  return startWhatsApp();
}

export async function requestWhatsAppPairingCode(phone: string) {
  const number = normalizePhone(phone);
  if (!/^\d{8,15}$/.test(number)) throw new Error("Nomor WhatsApp harus format internasional, contoh 628123456789.");

  const sock = await startWhatsApp();
  if (status.connected) throw new Error("WhatsApp sudah terhubung.");

  // Tunggu sejenak agar socket siap menerima pairing code request
  await new Promise(res => setTimeout(res, 1500));

  const code = await sock.requestPairingCode(number);
  status.phone = number;
  status.pairingCode = code;
  status.qr = null;
  status.qrDataUrl = null;
  waBus.emit("status", { ...status });
  return code;
}

export async function disconnectWhatsApp(logout = false) {
  const sock = g.__aksesbotmuWaSocket as WASocket | undefined;
  if (sock) {
    try {
      if (logout) await sock.logout();
      else sock.end(undefined);
    } catch {}
  }
  g.__aksesbotmuWaSocket = null;
  status.connected = false;
  status.connecting = false;
  status.qr = null;
  status.qrDataUrl = null;
  status.pairingCode = null;
  if (logout) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  waBus.emit("status", { ...status });
}

export function getWhatsAppStatus() {
  return { ...status };
}
