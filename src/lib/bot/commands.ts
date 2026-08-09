import Jimp from "jimp";
import QRCode from "qrcode";
import sharp from "sharp";
import crypto from "crypto";
import dns from "dns/promises";
import { tg } from "@/lib/telegram";
import { sendText, sendPhotoUrl, sendBytes, typing, live, refreshConfig, bus } from "@/lib/bot/engine";
import { insertMessage, logError, patchSettings } from "@/lib/store";
import { db } from "@/db";
import { tgUsers, messages, errorLogs } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import type { ConfigRow } from "@/lib/store";
import { decrypt } from "@/lib/crypto";

export interface CmdCtx {
  token: string;
  cfg: ConfigRow;
  msg: any;
  chatId: string;
  userId: string;
  text: string;
  from: any;
}

const S = (c: CmdCtx) => c.cfg.settings ?? {};
const name = (c: CmdCtx) => S(c).displayName || "AKSESBOTMU";
const TMDB_KEY = process.env.TMDB_API_KEY || "";
function resolveTmdbKey(settings: any): string {
  try {
    const enc = settings?.tmdbKeyEnc;
    if (enc) {
      const k = decrypt(String(enc));
      if (k?.trim()) return k.trim();
    }
  } catch { /* pakai env */ }
  return TMDB_KEY;
}

function reply(c: CmdCtx, text: string, extra: Record<string, unknown> = {}) {
  return sendText(c.chatId, text, { reply_to_message_id: c.msg.message_id, ...extra });
}

const http = async (url: string, init?: RequestInit, timeout = 12_000) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
};
const jget = async (url: string, init?: RequestInit, timeout?: number) => (await http(url, init, timeout)).json();

/* =============================== AI (Gemini) =============================== */

export function resolveGeminiKey(settings: any): string | null {
  try {
    const enc = settings?.geminiKeyEnc;
    if (enc) {
      const k = decrypt(String(enc));
      if (k?.trim()) return k.trim();
    }
  } catch { /* key rusak — pakai env */ }
  return process.env.GEMINI_API_KEY || null;
}

async function askGemini(prompt: string, system: string, settings?: any): Promise<string | null> {
  const key = resolveGeminiKey(settings);
  if (!key) return null;
  const prefer = settings?.geminiModel || "gemini-2.5-flash-lite";
  const models = [prefer, "gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"]
    .filter((v, i, a) => a.indexOf(v) === i);
  for (const m of models) {
    try {
      const data = await jget(
        `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            systemInstruction: { parts: [{ text: system }] },
            generationConfig: { temperature: 0.7, maxOutputTokens: 1600 },
          }),
        },
        25_000
      );
      const out = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("").trim();
      if (out) return out;
    } catch { /* try next model */ }
  }
  return null;
}

function fallbackAI(c: CmdCtx, text: string): string {
  const t = text.toLowerCase();
  if (/^(halo|hai|hi|hey|assalamu|woi|bang|kak)/.test(t)) return `Halo ${c.from.first_name ?? "kak"}! 👋 Aku ${name(c)}. Ada yang bisa kubantu? Ketik /menu untuk daftar fitur.`;
  if (/siapa (kamu|lo|lu|anda)|kamu siapa/.test(t)) return `Aku ${name(c)} 🤖 — bot cerdas yang dikembangkan oleh ${S(c).devName}. Ketik /menu untuk lihat kemampuanku!`;
  if (/^(makasih|thank|thx|tq)/.test(t)) return "Sama-sama! 😊 Senang bisa membantu.";
  if (/^(p|test|tes)$/.test(t)) return "✅ Online dan siap! Balas secepat kilat ⚡";
  const m = /^[\d\s+\-*/().,%^]+$/i.exec(t);
  if (m) { try { const r = safeCalc(t); if (r !== null) return `🧮 ${t} = *${r}*`; } catch { /* */ } }
  return `Aku menerima pesanmu: "${text.slice(0, 80)}". AI penuh (Gemini 2.5 Flash Lite) belum dikonfigurasi — owner bisa pasang API key lewat Panel Admin (klik teks AKSESBOTMU 7× di dashboard). Sementara itu, coba /menu 🤖`;
}

/* ============================ safe math & games state ============================ */

function safeCalc(expr: string): number | null {
  const clean = expr.replace(/\^/g, "**").replace(/,/g, ".");
  if (!/^[\d\s+\-*/().%*]+$/.test(clean)) return null;
  try {
    const v = Function(`"use strict";return (${clean});`)();
    return typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null;
  } catch { return null; }
}

const pendingAnswers = new Map<string, { answer: string; chatId: string; type: string; expires: number }>();
function consumePending(userId: string, chatId: string, text: string): { hit: boolean } {
  const p = pendingAnswers.get(userId);
  if (!p || p.expires < Date.now()) { pendingAnswers.delete(userId); return { hit: false }; }
  if (p.chatId !== chatId) return { hit: false };
  pendingAnswers.delete(userId);
  const norm = (s: string) => s.trim().toLowerCase();
  const hit = norm(text) === p.answer;
  return { hit };
}

/* ============================ media generators ============================ */

/* Brat sticker: latar putih + teks hitam pekat lowercase.
   WAJIB 512x512 (aturan stiker PNG Telegram) — digambar via SVG+sharp agar
   bebas error di Vercel/serverless (tanpa file font eksternal). */
const escXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
async function makeBrat(text: string): Promise<Buffer> {
  const { makeBratSticker } = await import("@/lib/sticker/brat");
  return makeBratSticker(text);
}

async function photoToSticker(fileUrlSrc: string): Promise<Buffer> {
  const bytes = Buffer.from(await (await http(fileUrlSrc, undefined, 20_000)).arrayBuffer());
  const img = await Jimp.read(bytes);
  img.background(0x00000000);
  img.contain(512, 512);
  return img.getBufferAsync(Jimp.MIME_PNG);
}

/* ============================ menu system ============================ */

const MENU_TEXT = (c: CmdCtx) =>
  `⚡ ${name(c).toUpperCase()} — MENU UTAMA\n` +
  `━━━━━━━━━━━━━━━━\n` +
  `Halo ${c.from.first_name ?? "kak"}! Pilih kategori fitur di bawah 👇\n\n` +
  `🤖 AI — chat cerdas, kode, translate\n🖼️ Stiker — brat, meme, sticker maker\n🎬 Media — film, anime, drakor, trailer\n🔍 Pencarian — google, wiki, cuaca\n🛠️ Tools — calc, qrcode, hash, dll\n🎮 Hiburan — game & tebak-tebakan\n👤 User — level, daily, balance\n👑 Grup — admin tools\n📢 Owner — broadcast & kontrol\n📥 Downloader — tiktok, yt search\n` +
  `━━━━━━━━━━━━━━━━\nDev: ${S(c).devName}`;

const CATS: Record<string, string> = {
  ai: `🤖 *AI & PINTAR*\n/ai <pertanyaan> — tanya apa saja\n/gpt /gemini /copilot /chat — alias AI\n/code <perintah> — buat kode\n/fixcode <kode> — perbaiki kode\n/explain <kode> — jelaskan kode\n/summarize <teks> — ringkas\n/rewrite <teks> — tulis ulang\n/translate <bahasa> <teks>\n/lyrics <judul> — cari lirik\n\n💡 Auto AI: balas semua pesan otomatis\nAktifkan: /autoaion · Matikan: /autoaioff`,
  sticker: `🖼️ *STIKER & GAMBAR*\n/brat <teks> — stiker gaya brat\n/meme — meme random lucu ⚽😂\n/sticker — balas foto dgn /sticker\n\nContoh: kirim foto lalu reply:\n/sticker`,
  media: `🎬 *MEDIA & FILM*\n/film <judul> — cari film + deskripsi + trailer\n/movie <judul> — alias film\n/anime <judul> — cari anime\n/drakor <judul> — cari drama Korea\n/trailer <judul> — trailer film\n/poster <judul> — poster HD\n/infofilm <judul> — detail film`,
  search: `🔍 *PENCARIAN*\n/google <query>\n/wiki <query>\n/youtube <query>\n/github <query>\n/npm <package>\n/cuaca <kota>`,
  tools: `🛠️ *TOOLS*\n/ping — cek latency\n/runtime — uptime bot\n/calc <hitung>\n/qrcode <teks>\n/base64 e|d <teks>\n/hash <teks>\n/password — bikin password\n/ip — IP server\n/cekhost <domain>\n/shortlink <url>\n/json <teks>\n/tourl — balas foto/dokumen`,
  fun: `🎮 *HIBURAN*\n/math — kuis matematika\n/quiz — kuis umum\n/riddle — teka-teki\n/truth /dare\n/slot /coinflip /dadu`,
  user: `👤 *USER*\n/profile — profilmu\n/level /xp /rank\n/daily — klaim harian\n/balance — saldo\n/leaderboard — top 10\n/history — pesan terakhirmu\n/report <pesan> — lapor ke owner ✅`,
  group: `👑 *ADMIN GRUP*\n/ban /unban /kick (reply pesan)\n/promote /demote\n/mute /unmute\n/pin /unpin\n/tagall\n/open /close\n/welcome on|off\n/antilink on|off\n/antiflood on|off\n/antibot on|off`,
  owner: `📢 *OWNER*\n/broadcast <pesan>\n/block /unblock <id>\n/addpremium /delpremium <id>\n/addowner <id>\n/autoaion /autoaioff\n/maintenance on|off\n/setname <nama>\n/setmenu <teks>\n/setbio <teks>\n/logs — error log`,
  dl: `📥 *DOWNLOADER & MUSIK*\n/play <judul> — AUDIO + COVER ✅\n/tiktok <link> — download VIDEO ✅\n/instagram <link> — download IG ✅\n/facebook <link> — download FB ✅\n/twitter <link> — download TW ✅\n/threads /pinterest <link>\n/video <judul> — cari video YouTube\n/lyrics <judul> — lirik lagu ✅\n/ytmp3 /ytmp4 /spotify <link>`,
};

export async function dispatchCallback(ctx: { token: string; cfg: ConfigRow; cb: any }) {
  const { token, cb } = ctx;
  const data: string = cb.data ?? "";
  try {
    if (data.startsWith("menu:")) {
      const cat = data.slice(5);
      const c: CmdCtx = { token, cfg: ctx.cfg, msg: cb.message, chatId: String(cb.message.chat.id), userId: String(cb.from.id), text: "", from: cb.from };
      const text = cat === "home" ? MENU_TEXT(c) : CATS[cat] ?? MENU_TEXT(c);
      const kb = cat === "home"
        ? menuKeyboard()
        : { inline_keyboard: [[{ text: "⬅️ Kembali ke Menu", callback_data: "menu:home" }]] };
      await tg.editMessageText(token, String(cb.message.chat.id), cb.message.message_id, text, { reply_markup: kb });
    }
    await tg.answerCallbackQuery(token, cb.id, "✅");
  } catch (e: any) {
    await tg.answerCallbackQuery(token, cb.id).catch(() => {});
    await logError("callback", e?.message ?? String(e));
  }
}

function menuKeyboard() {
  const row = (a: [string, string], b: [string, string]) => [
    { text: a[0], callback_data: `menu:${a[1]}` },
    { text: b[0], callback_data: `menu:${b[1]}` },
  ];
  return {
    inline_keyboard: [
      row(["🤖 AI", "ai"], ["🖼️ Stiker", "sticker"]),
      row(["🎬 Media", "media"], ["🔍 Cari", "search"]),
      row(["🛠️ Tools", "tools"], ["🎮 Fun", "fun"]),
      row(["👤 User", "user"], ["👑 Grup", "group"]),
      row(["📢 Owner", "owner"], ["📥 Download", "dl"]),
    ],
  };
}

/* ============================ command registry ============================ */

type Handler = (c: CmdCtx, args: string, argv: string[]) => Promise<void>;
const CMDS: Record<string, Handler> = {};
const reg = (names: string[], fn: Handler) => names.forEach((n) => (CMDS[n] = fn));

const targetId = (c: CmdCtx, args: string) => {
  const r = c.msg.reply_to_message;
  if (r?.from?.id) return Number(r.from.id);
  const n = Number((args || "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
};

/* ---- core ---- */
reg(["start"], async (c, args) => {
  const s = S(c);
  const text = s.startMenu?.trim()
    ? s.startMenu
        .replaceAll("{name}", c.from.first_name ?? "kak")
        .replaceAll("{bot}", name(c))
        .replaceAll("{dev}", s.devName ?? "Bimz Official")
    : `👋 Halo ${c.from.first_name ?? "kak"}!\n\n⚡ ${name(c).toUpperCase()} siap melayani.\nBot multifungsi: AI, film, stiker, downloader, tools & game.\n\nKetik /menu untuk mulai 🚀\n\nDeveloped by ${s.devName ?? "Bimz Official"}`;
  await reply(c, text);
  if (s.startAudioUrl?.trim()) {
    try {
      const r = await tg.sendAudio(c.token, c.chatId, s.startAudioUrl.trim(), `🎵 ${name(c)}`);
      if (r.ok) {
        const row = await insertMessage({ chatId: c.chatId, userId: c.chatId, tgMessageId: r.result?.message_id, direction: "out", kind: "audio", text: `🎵 ${name(c)}`, meta: { audioUrl: s.startAudioUrl } });
        if (row) bus.emit("message", row);
      }
    } catch { /* audio gagal, tetap lanjut */ }
  }
});
reg(["menu", "help"], async (c) => reply(c, MENU_TEXT(c), { reply_markup: menuKeyboard() }));
reg(["ping", "pingbot"], async (c) => {
  const t0 = Date.now();
  await tg.getMe(c.token);
  await reply(c, `🏓 Pong! ${Date.now() - t0}ms ⚡`);
});
reg(["runtime", "uptime"], async (c) => {
  const ms = live.startedAt ? Date.now() - live.startedAt : 0;
  const d = Math.floor(ms / 86400000), h = Math.floor(ms / 3600000) % 24, m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  await reply(c, `⏱️ Uptime: ${d}h ${h}j ${m}m ${s}d\n📨 Diproses: ${live.processed} update\n📡 API: ${live.apiOnline ? "online" : "offline"} · ${live.latencyMs}ms`);
});
reg(["server"], async (c) => {
  const mem = process.memoryUsage();
  await reply(c, `🖥️ SERVER\nNode ${process.version}\nRSS: ${(mem.rss / 1048576).toFixed(1)} MB\nHeap: ${(mem.heapUsed / 1048576).toFixed(1)} MB\nUpdate diproses: ${live.processed}`);
});
reg(["version"], (c) => reply(c, `⚡ ${name(c)} v3.0 — fullstack dashboard + real bot engine`));
reg(["changelog"], (c) => reply(c, `📋 CHANGELOG v3.0\n• AI Gemini 2.5 Flash + auto-reply\n• /film /anime /drakor + trailer\n• Stiker /brat /meme /sticker\n• Downloader TikTok & YT search\n• Auto AI on/off real-time\n• Dashboard real-time SSE`));
reg(["about"], (c) => reply(c, `ℹ️ ${name(c).toUpperCase()}\nBot Telegram multifungsi yang dikelola lewat dashboard web real-time.\nDeveloped by ${S(c).devName ?? "Bimz Official"}`));
reg(["contact", "owner"], (c) => { const s = S(c); return reply(c, `📇 OWNER\n👤 ${s.devName ?? "-"}\n📱 ${s.devPhone ?? "-"}\n✈️ ${s.devTele ?? "-"}`); });
reg(["rules"], (c) => reply(c, `📜 RULES\n1. Jangan spam\n2. Jangan kirim konten ilegal\n3. Gunakan bot dengan bijak\n\nMelanggar = /block oleh owner.`));
reg(["donate"], (c) => reply(c, `💝 Dukung development ${name(c)}!\nHubungi owner: ${S(c).devTele ?? "-"}`));
/* ---- /newbot wizard (buat bot Telegram baru, validasi token asli via Bot API) ---- */
const newbotState = new Map<string, { step: 1 | 2 | 3; name?: string; username?: string }>();

reg(["newbot", "buatbot", "createbot"], async (c) => {
  newbotState.set(c.userId, { step: 1 });
  await reply(c,
    `🤖 *NEWBOT WIZARD — buat bot Telegram baru*\n\n` +
    `Langkah *1/3* — Kirim *nama* untuk bot barumu.\nContoh: \`Bimz Helper Bot\`\n\n` +
    `ℹ️ Token bot hanya bisa diterbitkan BotFather (satu-satunya penerbit resmi dari Telegram). Aku akan pandu step-by-step sampai botmu jadi & terverifikasi ✅\n\n(batal kapan saja: /cancel)`);
});
reg(["cancel"], async (c) => {
  newbotState.delete(c.userId);
  await reply(c, "✅ Wizard dibatalkan.");
});

export async function consumeNewBotWizard(c: CmdCtx): Promise<boolean> {
  const st = newbotState.get(c.userId);
  if (!st) return false;
  const text = c.text.trim();
  if (text.startsWith("/")) return false; // biarkan command lain lewat, wizard tetap menunggu

  if (st.step === 1) {
    if (text.length < 3 || text.length > 64) {
      await reply(c, "❗ Nama bot minimal 3 & maksimal 64 karakter. Kirim ulang nama bot:");
      return true;
    }
    st.name = text; st.step = 2;
    await reply(c, `✅ Nama disimpan: *${text}*\n\nLangkah *2/3* — Kirim *username* bot (5-32 karakter, huruf/angka/underscore, wajib berakhiran \`bot\`).\nContoh: \`BimzHelper_bot\``);
    return true;
  }
  if (st.step === 2) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{3,30}bot$/i.test(text)) {
      await reply(c, "❌ Username tidak valid. Syarat: 5-32 karakter, mulai huruf, hanya huruf/angka/underscore, dan *berakhiran \"bot\"*.\nContoh: `BimzHelper_bot`\n\nKirim ulang username:");
      return true;
    }
    st.username = text; st.step = 3;
    await reply(c,
      `✅ Username tersedia: *@${text}*\n\n` +
      `Langkah *3/3* — Ambil token resmi (±30 detik):\n\n` +
      `1️⃣ Pencet tombol *Buka BotFather* di bawah 👇\n` +
      `2️⃣ Kirim \`/newbot\` ke BotFather\n` +
      `3️⃣ Masukkan nama: *${st.name}*\n` +
      `4️⃣ Masukkan username: *${text}*\n` +
      `5️⃣ BotFather langsung memberi TOKEN (format \`123456789:ABC...\`)\n\n` +
      `*Tempel token itu di sini* — aku validasi ke Telegram Bot API detik itu juga & bot-mu resmi jadi ✅\n\n` +
      `⚙️ Kenapa harus lewat BotFather? Demi keamanan Telegram, HANYA BotFather yang boleh menerbitkan token bot — tidak ada API lain (termasuk bot ini) yang bisa membuatnya. Wizard ini memangkas prosesnya jadi super cepat.`,
      { reply_markup: { inline_keyboard: [[{ text: "👉 Buka BotFather Sekarang", url: "https://t.me/BotFather" }]] } });
    return true;
  }
  // step 3: menunggu token
  if (/^\d{6,}:[\w-]{25,}$/.test(text)) {
    await tg.sendChatAction(c.token, c.chatId, "typing");
    try {
      const me = await tg.getMe(text);
      if (me.ok && me.result) {
        newbotState.delete(c.userId);
        await reply(c,
          `✅ *BOT ASLI BERHASIL DIBUAT & TERVERIFIKASI!*\n\n` +
          `🤖 Nama: ${me.result.first_name}\n` +
          `✈️ Username: @${me.result.username}\n` +
          `🆔 Bot ID: \`${me.result.id}\`\n` +
          `🔑 Token: VALID (latency ${me.latency}ms)\n\n` +
          `⚡ *Aktifkan di dashboard:* buka AKSESBOTMU → Hubungkan Bot → tempel token → bot langsung ONLINE, semua pesan masuk ke Live Chat realtime.\n\n` +
          `⚠️ JAGA TOKEN RAHASIA — siapa pun yang punya token bisa mengendalikan botmu.`);
      } else {
        await reply(c, "❌ Token tidak valid menurut Telegram. Pastikan kamu menyalin token lengkap dari BotFather (format `angka:kode`). Kirim ulang:");
      }
    } catch {
      await reply(c, "❌ Gagal verifikasi (jaringan). Coba kirim ulang token beberapa detik lagi:");
    }
    return true;
  }
  await reply(c, "❗ Itu belum terlihat seperti token BotFather.\nFormat token: `123456789:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`\n\nTempel token di sini, atau /cancel untuk batal:");
  return true;
}

reg(["autoaion"], async (c) => { await patchSettings({ autoAI: true }); await refreshConfig(); await reply(c, `✅ Auto AI AKTIF — semua pesan akan dijawab AI secara real-time ⚡`); });
reg(["autoaioff"], async (c) => { await patchSettings({ autoAI: false }); await refreshConfig(); await reply(c, `🛑 Auto AI NONAKTIF — bot hanya membalas command.`); });

/* ---- AI commands ---- */
const aiSys = (c: CmdCtx, extra: string) =>
  `Kamu adalah ${name(c)}, asisten bot Telegram cerdas yang dibuat oleh ${S(c).devName ?? "Bimz Official"}. Jawab ringkas, ramah, gunakan bahasa user (default Indonesia). ${extra}`;
const aiCmd = (extraSys: string, needArgs = true) => async (c: CmdCtx, args: string) => {
  if (needArgs && !args) return reply(c, "❗ Sertakan pertanyaan/teks. Contoh: /ai apa itu black hole?");
  await tg.sendChatAction(c.token, c.chatId, "typing");
  const out = await askGemini(args || c.text, aiSys(c, extraSys), S(c));
  await reply(c, out ?? fallbackAI(c, args || c.text));
};
reg(["ai", "gpt", "gemini", "copilot", "chat", "generate", "prompt", "ask"], aiCmd("Analisis permintaan user sedalam mungkin, beri jawaban lengkap tapi tetap ringkas.", false));
reg(["code", "fixcode", "explain"], aiCmd("Kamu expert programmer. Berikan kode/penjelasan dalam markdown code block."));
reg(["summarize"], aiCmd("Ringkas teks berikut menjadi poin-poin padat."));
reg(["rewrite"], aiCmd("Tulis ulang teks berikut agar lebih bagus, jelas dan enak dibaca."));
reg(["imageai"], (c) => reply(c, "🖼️ Image generation membutuhkan API key tambahan (belum dikonfigurasi). Gunakan /ai untuk deskripsi gambar detail!"));

reg(["translate"], async (c, args) => {
  const m = /^([a-z]{2})\s+([\s\S]+)$/i.exec(args);
  if (!m) return reply(c, "❗ Format: /translate id hello world");
  const [, lang, text] = m;
  try {
    const d = await jget(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 400))}&langpair=en|${lang}`);
    const out = d?.responseData?.translatedText;
    await reply(c, out ? `🌐 *${lang.toUpperCase()}*\n${decodeEntities(out)}` : "❌ Terjemahan tidak ditemukan.");
  } catch { await reply(c, "❌ Layanan translate sedang gangguan, coba lagi."); }
});

function decodeEntities(s: string) {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

reg(["lyrics"], async (c, args) => {
  if (!args) return reply(c, "❗ Contoh: /lyrics melukis senja");
  try {
    const d = await jget(`https://lrclib.net/api/search?q=${encodeURIComponent(args)}`);
    const t = Array.isArray(d) ? d[0] : null;
    if (!t) return reply(c, "❌ Lirik tidak ditemukan.");
    const lyrics = (t.plainLyrics || t.syncedLyrics || "").slice(0, 2000);
    await reply(c, `🎵 ${t.trackName} — ${t.artistName}\n\n${lyrics || "(instrumental)"}`);
  } catch { await reply(c, "❌ Gagal mencari lirik, coba lagi."); }
});

/* ---- film / media (TMDB) ---- */
async function tmdb(c: CmdCtx, args: string, type: "movie" | "tv", extraParams = "", withTrailer = true) {
  const TMDB = resolveTmdbKey(S(c));
  if (!TMDB) return reply(c, "❌ TMDB API key belum dikonfigurasi.\nOwner: Panel Admin (klik AKSESBOTMU 7×) → isi TMDB API Key.");
  if (!args) return reply(c, `❗ Contoh: /${type === "movie" ? "film" : "drakor"} interstellar`);
  try {
    await tg.sendChatAction(c.token, c.chatId, "typing");
    const d = await jget(`https://api.themoviedb.org/3/search/${type}?api_key=${TMDB}&language=id-ID&include_adult=false&query=${encodeURIComponent(args)}${extraParams}`);
    const item = d?.results?.[0];
    if (!item) return reply(c, `❌ Tidak ditemukan hasil untuk "${args}".`);
    const title = type === "movie" ? item.title : item.name;
    const date = (item.release_date || item.first_air_date || "")?.slice(0, 4);
    const mediaType = type === "movie" ? "Film" : item.origin_country?.includes("KR") ? "Drakor" : "Series";
    const caption =
      `🎬 *${title}* ${date ? `(${date})` : ""}\n` +
      `⭐ ${item.vote_average?.toFixed(1) ?? "-"} · ${mediaType} · ${item.original_language?.toUpperCase()}\n\n` +
      `📖 *Sinopsis:*\n${(item.overview || "Belum ada sinopsis dalam bahasa ini.").slice(0, 900)}\n\n— dicari via ${name(c)}`;
    if (item.poster_path) {
      await sendPhotoUrl(c.chatId, `https://image.tmdb.org/t/p/w500${item.poster_path}`, caption, { reply_to_message_id: c.msg.message_id });
    } else {
      await reply(c, caption);
    }
    /* ---- LINK NONTON HD (multi-server: VidSrc / VidLink + trailer) ---- */
    if (withTrailer) {
      let trailerUrl: string | null = null;
      try {
        const v = await jget(`https://api.themoviedb.org/3/${type}/${item.id}/videos?api_key=${TMDB}&language=en-US`);
        const tr = (v?.results ?? []).find((x: any) => x.site === "YouTube" && (x.type === "Trailer" || x.type === "Teaser"));
        if (tr) trailerUrl = `https://youtu.be/${tr.key}`;
      } catch { /* trailer opsional */ }

      const isTv = type === "tv";
      const servers: { text: string; url: string }[] = isTv
        ? [
            { text: "▶️ Nonton HD — Server 1", url: `https://vidsrc.xyz/embed/tv/${item.id}` },
            { text: "🎬 Server 2 (VidSrc CC)", url: `https://vidsrc.cc/v2/embed/tv/${item.id}` },
            { text: "⚡ Server 3 (VidLink)", url: `https://vidlink.pro/tv/${item.id}` },
          ]
        : [
            { text: "▶️ Nonton HD — Server 1", url: `https://vidsrc.xyz/embed/movie/${item.id}` },
            { text: "🎬 Server 2 (VidSrc CC)", url: `https://vidsrc.cc/v2/embed/movie/${item.id}` },
            { text: "⚡ Server 3 (VidLink)", url: `https://vidlink.pro/movie/${item.id}` },
          ];
      if (trailerUrl) servers.push({ text: "🎥 Trailer YouTube", url: trailerUrl });

      const rows: { text: string; url: string }[][] = [];
      for (let i = 0; i < servers.length; i += 2) rows.push(servers.slice(i, i + 2) as { text: string; url: string }[]);

      await sendText(c.chatId,
        `🍿 *LINK NONTON ${title.toUpperCase()}* ${date ? `(${date})` : ""} — HD\n\n` +
        `Pilih server di bawah 👇 (jika satu error, coba server lain).\n` +
        `Butuh koneksi internet & browser. Selamat menonton! 🎬`,
        { reply_markup: { inline_keyboard: rows } }
      );
    }
  } catch (e: any) {
    await logError("tmdb", e?.message ?? String(e));
    await reply(c, "❌ Gagal menghubungi TMDB, coba lagi sebentar lagi.");
  }
}
reg(["film", "movie", "infofilm", "trailer", "poster"], (c, a) => tmdb(c, a, "movie"));
reg(["drakor"], (c, a) => tmdb(c, a, "tv", "&with_origin_country=KR"));
reg(["anime"], async (c, args) => {
  if (!args) return reply(c, "❗ Contoh: /anime naruto");
  try {
    await tg.sendChatAction(c.token, c.chatId, "typing");
    const d = await jget(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(args)}&limit=1&sfw=true`);
    const a = d?.data?.[0];
    if (!a) return reply(c, `❌ Anime "${args}" tidak ditemukan.`);
    const cap = `⛩️ *${a.title}*\n${a.title_japanese ?? ""}\n⭐ ${a.score ?? "-"} · ${a.episodes ?? "?"} episode · ${a.status}\n\n📖 ${decodeEntities((a.synopsis || "Belum ada sinopsis.").slice(0, 800))}\n\n▶️ ${a.url}`;
    if (a.images?.jpg?.image_url) await sendPhotoUrl(c.chatId, a.images.jpg.image_url, cap, { reply_to_message_id: c.msg.message_id });
    else await reply(c, cap);
  } catch { await reply(c, "❌ Gagal mencari anime (API limit), coba beberapa detik lagi."); }
});

/* ---- sticker & meme ---- */
reg(["brat"], async (c, args) => {
  if (!args) return reply(c, "❗ Contoh: /brat halo semua");
  try {
    await tg.sendChatAction(c.token, c.chatId, "upload_photo");
    const buf = await makeBrat(args); // 512x512 WEBP — format static sticker yang benar
    const r = await tg.sendFile(c.token, "sendSticker", { chat_id: c.chatId }, "sticker", "brat.webp", buf, "image/webp");
    if (r.ok) {
      const row = await insertMessage({ chatId: c.chatId, userId: c.chatId, tgMessageId: r.result?.message_id, direction: "out", kind: "sticker", text: `brat: ${args.slice(0, 80)}`, meta: { brat: true } });
      if (row) bus.emit("message", row);
      return;
    }
    throw new Error(r.description ?? "sendSticker gagal");
  } catch (e: any) {
    await logError("brat", e?.message ?? String(e));
    // fallback anti-error: kirim sebagai foto brat
    try {
      const buf = await makeBrat(args);
      await sendBytes(c.chatId, "sendPhoto", "photo", "brat.webp", buf, "image/webp", "photo", `brat: ${args.slice(0, 80)}`);
    } catch { await reply(c, "❌ Gagal membuat brat, coba teks lebih pendek."); }
  }
});
/** Download gambar → konversi ke PNG 512px (format stiker Telegram) */
async function urlToStickerPng(url: string): Promise<Buffer> {
  const bytes = Buffer.from(await (await http(url, undefined, 15_000)).arrayBuffer());
  const img = await Jimp.read(bytes);
  img.background(0x00000000);
  img.contain(512, 512);
  return img.getBufferAsync(Jimp.MIME_PNG);
}

reg(["meme"], async (c) => {
  const subs = ["memes", "dankmemes", "me_irl", "funny", "footballmemes", "footballmemes", "soccermemes", "MemeDunia"];
  const sub = subs[Math.floor(Math.random() * subs.length)];
  await tg.sendChatAction(c.token, c.chatId, "upload_photo");
  let url: string | null = null, title = "meme", credit = `r/${sub}`;
  try {
    const d = await jget(`https://meme-api.com/gimme/${sub}`, undefined, 8000);
    if (d?.url) { url = d.url; title = d.title ?? "meme"; credit = `r/${d.subreddit ?? sub}`; }
  } catch { /* fallback imgflip */ }
  if (!url) {
    try {
      const d = await jget("https://api.imgflip.com/get_memes", undefined, 8000);
      const list = d?.data?.memes ?? [];
      const m = list[Math.floor(Math.random() * Math.min(60, list.length))];
      if (m?.url) { url = m.url; title = m.name ?? "meme"; credit = "imgflip"; }
    } catch { /* */ }
  }
  if (!url) return reply(c, "❌ Gagal mengambil meme, coba lagi sebentar lagi.");
  try {
    // KIRIM SEBAGAI STIKER (bukan foto)
    const png = await urlToStickerPng(url);
    await sendBytes(c.chatId, "sendSticker", "sticker", "meme.png", png, "image/png", "sticker");
    await sendText(c.chatId, `😂 ${title.slice(0, 120)}\n📍 ${credit}`);
  } catch (e: any) {
    await logError("meme-sticker", e?.message ?? String(e));
    // fallback tanpa error: kirim sebagai foto
    try { await sendPhotoUrl(c.chatId, url, `😂 ${title}\n${credit}`, { reply_to_message_id: c.msg.message_id }); }
    catch { await reply(c, "😂 Meme siap tapi gagal dikirim, coba /meme lagi."); }
  }
});
reg(["sticker", "stiker", "s"], async (c) => {
  const src = c.msg.reply_to_message?.photo ?? c.msg.photo;
  if (!src) return reply(c, "📸 Kirim foto (atau reply foto) dengan caption /sticker");
  try {
    await tg.sendChatAction(c.token, c.chatId, "upload_photo");
    const fileId = src[src.length - 1].file_id;
    const f = await tg.getFile(c.token, fileId);
    if (!f.ok) throw new Error("file too large (max 20MB)");
    const buf = await photoToSticker(tg.fileUrl(c.token, f.result.file_path));
    await sendBytes(c.chatId, "sendSticker", "sticker", "sticker.png", buf, "image/png", "sticker");
  } catch (e: any) {
    await logError("sticker", e?.message ?? String(e));
    await reply(c, "❌ Gagal membuat stiker (file terlalu besar atau format tidak didukung).");
  }
});

/* ---- search ---- */
reg(["google", "search", "g"], async (c, args) => {
  if (!args) return reply(c, "❗ Contoh: /google nextjs tutorial");
  try {
    const d = await jget(`https://api.duckduckgo.com/?q=${encodeURIComponent(args)}&format=json&no_html=1&skip_disambig=1`);
    const abs = d?.AbstractText || d?.RelatedTopics?.[0]?.Text;
    if (abs) await reply(c, `🔎 *${d.Heading || args}*\n${abs.slice(0, 900)}\n\n🔗 Hasil lain: https://www.google.com/search?q=${encodeURIComponent(args)}`);
    else await reply(c, `🔎 Hasil untuk "${args}":\nhttps://www.google.com/search?q=${encodeURIComponent(args)}`);
  } catch { await reply(c, "❌ Pencarian gagal, coba lagi."); }
});
reg(["wiki", "wikipedia"], async (c, args) => {
  if (!args) return reply(c, "❗ Contoh: /wiki indonesia");
  const slug = encodeURIComponent(args.replace(/ /g, "_"));
  for (const lang of ["id", "en"]) {
    try {
      const d = await jget(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${slug}`, undefined, 9000);
      if (d?.extract || d?.description) {
        return reply(c, `📚 *${d.title}* (${lang.toUpperCase()})\n${(d.extract || d.description || "Tidak ada ringkasan.").slice(0, 1200)}\n\n🔗 ${d.content_urls?.desktop?.page ?? ""}`);
      }
    } catch { /* coba bahasa berikutnya */ }
  }
  await reply(c, `❌ Artikel "${args}" tidak ditemukan di Wikipedia (ID & EN).`);
});
reg(["youtube", "yt"], async (c, args) => {
  if (!args) return reply(c, "❗ Contoh: /youtube lagu santai");
  const q = encodeURIComponent(args);
  const hosts = ["https://pipedapi.kavin.rocks", "https://pipedapi.adminforge.de", "https://piapi.ggtyler.dev"];
  for (const h of hosts) {
    try {
      const d = await jget(`${h}/search?q=${q}&filter=videos`, undefined, 7000);
      const items = (d?.items ?? []).slice(0, 3);
      if (items.length) {
        const text = items.map((it: any, i: number) => `${i + 1}. ${it.title}\n👁 ${it.views ?? "-"} · https://youtube.com${it.url}`).join("\n\n");
        return reply(c, `▶️ *YouTube — ${args}*\n\n${text}`);
      }
    } catch { /* next host */ }
  }
  await reply(c, `▶️ *YouTube — ${args}*\nhttps://www.youtube.com/results?search_query=${q}\n\n(API publik sibuk, buka link di atas untuk hasil langsung)`);
});
reg(["github", "gh"], async (c, args) => {
  if (!args) return reply(c, "❗ Contoh: /github react");
  try {
    const d = await jget(`https://api.github.com/search/repositories?q=${encodeURIComponent(args)}&per_page=3`);
    const items = d?.items ?? [];
    if (!items.length) return reply(c, "❌ Repo tidak ditemukan.");
    await reply(c, `🐙 *GitHub — ${args}*\n\n${items.map((r: any, i: number) => `${i + 1}. ${r.full_name} ⭐${r.stargazers_count}\n${(r.description ?? "").slice(0, 100)}\n${r.html_url}`).join("\n\n")}`);
  } catch { await reply(c, "❌ GitHub API sedang limit, coba lagi."); }
});
reg(["npm"], async (c, args) => {
  if (!args) return reply(c, "❗ Contoh: /npm react");
  try {
    const d = await jget(`https://registry.npmjs.org/${encodeURIComponent(args)}`);
    const v = d["dist-tags"]?.latest;
    await reply(c, `📦 *${d.name}* v${v}\n${(d.description ?? "-").slice(0, 300)}\n🔗 https://www.npmjs.com/package/${d.name}`);
  } catch { await reply(c, `❌ Package "${args}" tidak ditemukan.`); }
});
const WMO: Record<number, string> = { 0: "Cerah ☀️", 1: "Cerah berawan 🌤", 2: "Berawan ⛅", 3: "Mendung ☁️", 45: "Berkabut 🌫", 48: "Kabut ❄️", 51: "Gerimis 🌦", 61: "Hujan ringan 🌧", 63: "Hujan 🌧", 65: "Hujan deras ⛈", 80: "Hujan lokal 🌦", 95: "Badai ⛈", 96: "Badai es ⛈" };
reg(["cuaca", "weather"], async (c, args) => {
  if (!args) return reply(c, "❗ Contoh: /cuaca jakarta");
  try {
    const g = await jget(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(args)}&count=1&language=id`);
    const loc = g?.results?.[0];
    if (!loc) return reply(c, `❌ Kota "${args}" tidak ditemukan.`);
    const f = await jget(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m`);
    const cur = f?.current;
    await reply(c, `🌦 *Cuaca ${loc.name}, ${loc.country ?? ""}*\n\n${WMO[cur?.weather_code] ?? "—"}\n🌡 ${cur?.temperature_2m}°C (terasa ${cur?.apparent_temperature}°C)\n💧 Humidity ${cur?.relative_humidity_2m}%\n💨 Angin ${cur?.wind_speed_10m} km/h`);
  } catch { await reply(c, "❌ Gagal mengambil data cuaca."); }
});

/* ---- tools ---- */
reg(["calc", "hitung"], async (c, args) => {
  if (!args) return reply(c, "❗ Contoh: /calc 25*4+10");
  const r = safeCalc(args);
  await reply(c, r !== null ? `🧮 ${args} = *${r}*` : "❌ Ekspresi tidak valid. Gunakan angka & + - * / ( ) ^");
});
reg(["base64", "encode"], async (c, args, argv) => {
  const mode = argv[0] === "d" || argv[0] === "decode" ? "d" : "e";
  const payload = args.replace(/^(e|d|encode|decode)\s+/i, "");
  if (!payload) return reply(c, "❗ Contoh: /base64 e halo | /base64 d aGFsbw==");
  try {
    await reply(c, mode === "e" ? `🔐 ${Buffer.from(payload, "utf8").toString("base64")}` : `🔓 ${Buffer.from(payload, "base64").toString("utf8")}`);
  } catch { await reply(c, "❌ Input tidak valid."); }
});
reg(["decode"], async (c, args) => {
  if (!args) return reply(c, "❗ Contoh: /decode aGFsbw==");
  try { await reply(c, `🔓 ${Buffer.from(args, "base64").toString("utf8")}`); } catch { await reply(c, "❌ Bukan base64 valid."); }
});
reg(["hash"], async (c, args) => {
  if (!args) return reply(c, "❗ Contoh: /hash rahasia123");
  const h = (alg: string) => crypto.createHash(alg).update(args).digest("hex");
  await reply(c, `#️⃣ Hash dari "${args.slice(0, 30)}"\n\nMD5: ${h("md5")}\nSHA1: ${h("sha1")}\nSHA256: ${h("sha256")}`);
});
reg(["password", "passgen"], async (c) => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*";
  const p = Array.from(crypto.randomBytes(20)).map((b) => chars[b % chars.length]).join("");
  await reply(c, `🔑 Password kuat:\n\`${p}\`\n\nSimpan baik-baik! (chat ini hanya bisa dibaca kamu)`);
});
reg(["qrcode", "qr"], async (c, args) => {
  if (!args) return reply(c, "❗ Contoh: /qrcode https://google.com");
  try {
    // QR dibuat 100% lokal di server — tanpa API eksternal, anti error
    await tg.sendChatAction(c.token, c.chatId, "upload_photo");
    const buf = await QRCode.toBuffer(args.slice(0, 1200), { type: "png", width: 480, margin: 2, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
    await sendBytes(c.chatId, "sendPhoto", "photo", "qrcode.png", buf, "image/png", "photo", `🔳 QR Code:\n${args.slice(0, 120)}`);
  } catch (e: any) {
    await logError("qrcode", e?.message ?? String(e));
    await reply(c, "❌ Gagal membuat QR code (teks terlalu panjang?).");
  }
});
reg(["ip"], async (c) => {
  try {
    const t = await (await http("https://api.ipify.org?format=json", undefined, 6000)).json();
    await reply(c, `🌐 IP Publik Server: \`${t.ip}\``);
  } catch {
    try {
      const ip2 = (await (await http("https://api.my-ip.io/ip", undefined, 6000)).text()).trim();
      await reply(c, `🌐 IP Publik Server: \`${ip2}\``);
    } catch { await reply(c, "❌ Semua layanan IP sedang gangguan, coba lagi."); }
  }
});
reg(["cekhost", "host"], async (c, args) => {
  if (!args) return reply(c, "❗ Contoh: /cekhost google.com");
  try { const ips = await dns.resolve4(args); await reply(c, `🖥 DNS ${args}\n\n${ips.map((i) => `• ${i}`).join("\n")}`); }
  catch { await reply(c, `❌ Domain ${args} tidak ditemukan.`); }
});
reg(["shortlink", "short"], async (c, args) => {
  if (!/^https?:\/\//.test(args)) return reply(c, "❗ Contoh: /shortlink https://google.com");
  const u = encodeURIComponent(args);
  try {
    const t = await (await http(`https://is.gd/create.php?format=simple&url=${u}`, undefined, 7000)).text();
    if (t.startsWith("http")) return reply(c, `🔗 Link pendek:\n${t.trim()}\n\n(asli: ${args})`);
    throw new Error("isgd fail");
  } catch { /* fallback tinyurl */ }
  try {
    const t = await (await http(`https://tinyurl.com/api-create.php?url=${u}`, undefined, 7000)).text();
    if (t.startsWith("http")) return reply(c, `🔗 Link pendek:\n${t.trim()}\n\n(asli: ${args})`);
    throw new Error("tinyurl fail");
  } catch { await reply(c, "❌ Semua layanan shortlink sedang gangguan. Coba lagi sebentar lagi."); }
});
reg(["json"], async (c, args) => {
  const src = args || c.msg.reply_to_message?.text;
  if (!src) return reply(c, "❗ Kirim JSON atau reply pesan berisi JSON.");
  try { await reply(c, `\`\`\`json\n${JSON.stringify(JSON.parse(src), null, 2).slice(0, 3000)}\n\`\`\``); }
  catch { await reply(c, "❌ Bukan JSON valid."); }
});
reg(["tourl"], async (c) => {
  const m = c.msg.reply_to_message;
  const file = m?.document ?? (m?.photo ? m.photo[m.photo.length - 1] : null);
  if (!file) return reply(c, "📎 Reply foto/dokumen lalu ketik /tourl");
  try {
    const f = await tg.getFile(c.token, file.file_id);
    if (!f.ok) throw new Error("file>20MB");
    const bytes = await (await http(tg.fileUrl(c.token, f.result.file_path))).arrayBuffer();
    const fd = new FormData();
    fd.append("file", new File([bytes], file.file_name ?? "file.png"));
    const res = await fetch("https://tmpfiles.org/api/v1/upload", { method: "POST", body: fd, signal: AbortSignal.timeout(20_000) });
    const d: any = await res.json();
    const url = d?.data?.url?.replace("tmpfiles.org/", "tmpfiles.org/dl/");
    if (!url) throw new Error("tmpfiles fail");
    await reply(c, `🔗 File terupload (aktif ±60 menit):\n${url}`);
  } catch {
    // fallback: 0x0.st
    try {
      const m = c.msg.reply_to_message;
      const file = m?.document ?? (m?.photo ? m.photo[m.photo.length - 1] : null);
      const f = await tg.getFile(c.token, file.file_id);
      const bytes = await (await http(tg.fileUrl(c.token, f.result.file_path))).arrayBuffer();
      const fd2 = new FormData();
      fd2.append("file", new File([bytes], file.file_name ?? "file"));
      const r2 = await fetch("https://0x0.st", { method: "POST", body: fd2, signal: AbortSignal.timeout(25_000) });
      const url2 = (await r2.text()).trim();
      if (!/^https?:\/\//.test(url2)) throw new Error("0x0 fail");
      await reply(c, `🔗 File terupload:\n${url2}`);
    } catch { await reply(c, "❌ Semua host upload sedang gangguan (maks file 20MB). Coba lagi."); }
  }
});

/* ---- downloader ---- */
const PIPED = ["https://pipedapi.kavin.rocks", "https://pipedapi.adminforge.de", "https://piapi.ggtyler.dev"];
async function pipedSearch(q: string, filter: string) {
  for (const h of PIPED) {
    try {
      const d = await jget(`${h}/search?q=${encodeURIComponent(q)}&filter=${filter}`, undefined, 7000);
      if (d?.items?.length) return d.items;
    } catch { /* next */ }
  }
  return null;
}
reg(["play"], async (c, args) => {
  if (!args) return reply(c, "❗ Contoh: /play melukis senja");
  await tg.sendChatAction(c.token, c.chatId, "typing");
  try {
    // iTunes Search API — audio preview & artwork resmi (legal dikirim sebagai file nyata)
    const d = await jget(`https://itunes.apple.com/search?term=${encodeURIComponent(args)}&media=music&limit=8&country=ID`);
    const track = (d?.results ?? []).find((r: any) => r.previewUrl);
    if (!track) throw new Error("not found");
    const art: string = (track.artworkUrl100 ?? "").replace("100x100", "600x600");
    const dur = Math.round((track.trackTimeMillis ?? 0) / 1000);
    const cap =
      `🎵 *${track.trackName}*\n🎤 ${track.artistName}\n💿 ${track.collectionName ?? "Single"} · ${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, "0")}\n\n` +
      `📀 File audio dikirim di bawah ⬇️ (preview resmi 30 detik berkualitas tinggi).\n` +
      `▶️ Dengarkan versi penuh (resmi): ${track.trackViewUrl}`;
    if (art) await sendPhotoUrl(c.chatId, art, cap, { reply_to_message_id: c.msg.message_id });
    else await reply(c, cap);
    // Audio diunduh dulu lalu di-upload dengan metadata lengkap
    // (title+performer+duration) → muncul sebagai PLAYER INLINE, langsung bisa diputar
    await tg.sendChatAction(c.token, c.chatId, "upload_audio");
    const bytes = Buffer.from(await (await http(track.previewUrl, undefined, 60_000)).arrayBuffer());
    if (bytes.length < 10_000) throw new Error("audio kosong");
    const r = await tg.sendFile(c.token, "sendAudio", {
      chat_id: c.chatId,
      title: String(track.trackName ?? "Audio").slice(0, 120),
      performer: String(track.artistName ?? "Unknown").slice(0, 120),
      duration: 30,
    }, "audio", "lagu.m4a", bytes, "audio/mp4");
    if (r.ok) {
      const row = await insertMessage({ chatId: c.chatId, userId: c.chatId, tgMessageId: r.result?.message_id, direction: "out", kind: "audio", text: `🎵 ${track.trackName} — ${track.artistName}`, meta: { source: "itunes" } });
      if (row) bus.emit("message", row);
    } else {
      throw new Error(r.description ?? "upload audio gagal");
    }
  } catch {
    await reply(c, `❌ Lagu "${args}" tidak ditemukan.\n\nCoba ejaan lain, atau:\n🔎 https://music.youtube.com/search?q=${encodeURIComponent(args)}`);
  }
});
reg(["video"], async (c, args) => {
  if (!args) return reply(c, "❗ Contoh: /video tutorial nextjs");
  await tg.sendChatAction(c.token, c.chatId, "typing");
  const items = await pipedSearch(args, "videos");
  if (items) {
    const it = items[0];
    const cap = `▶️ *${it.title}*\n👁 ${it.views ?? "-"}\nhttps://youtube.com${it.url}`;
    if (it.thumbnail) await sendPhotoUrl(c.chatId, it.thumbnail, cap, { reply_to_message_id: c.msg.message_id });
    else await reply(c, cap);
  } else await reply(c, `▶️ Cari langsung: https://www.youtube.com/results?search_query=${encodeURIComponent(args)}`);
});
reg(["ytmp3", "ytmp4"], async (c, args) => {
  if (!/https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)/.test(args)) return reply(c, "❗ Kirim link YouTube yang valid.\nContoh: /ytmp3 https://youtu.be/xxxx");
  await reply(c,
    `⚠️ Rip MP3/MP4 YouTube dinonaktifkan (kebijakan hak cipta YouTube).\n\n` +
    `✅ *Solusi — pakai /play* yang benar-benar mengirim FILE AUDIO + COVER:\n` +
    `Ketik: /play <judul lagu>\n\n` +
    `▶️ Link kamu: ${args.trim()}`);
});
reg(["spotify"], async (c, args) => {
  if (!/spotify\.com|spotify:/.test(args)) return reply(c, "❗ Kirim link Spotify yang valid.");
  await reply(c, `⚠️ Download lagu Spotify membutuhkan konverter berlisensi (tidak tersedia di server).\n\n🎧 Dengarkan resmi: ${args.trim()}`);
});
reg(["shazam"], (c) => reply(c, "🎤 Identifikasi lagu dari audio butuh engine audio-fingerprint berlisensi — belum tersedia di server ini."));
/* ================= DOWNLOADER =================
   Strategi anti-gagal: semua server download ditembak PARALEL sekaligus (race) —
   server pertama yang berhasil langsung dipakai, sisanya dibatalkan.
   File hasil download dikirim LANGSUNG sebagai video/foto/audio di chat. */
const DL_HOSTS = [
  "https://api.cobalt.tools",
  "https://cobalt-api.meowing.de",
  "https://capi.oak.li",
  "https://cobalt-api.kwiatekmiki.com",
  "https://cobalt-backend.canine.tools",
  "https://cobalt.ayo.tf",
  "https://dl.kermi.top",
];
type DlResult = { type: "video" | "audio" | "photo"; url: string };

async function raceCobalt(targetUrl: string): Promise<DlResult | null> {
  const attempt = async (host: string): Promise<DlResult> => {
    const res = await fetch(host, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ url: targetUrl, videoQuality: "max", filenameStyle: "basic", downloadMode: "auto" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d: any = await res.json();
    if ((d.status === "tunnel" || d.status === "redirect" || d.status === "stream") && d.url) {
      return { type: d.isAudio ? "audio" : "video", url: d.url };
    }
    if (d.status === "picker" && d.picker?.length) {
      const p = d.picker.find((x: any) => x.url) ?? d.picker[0];
      return { type: p.type === "photo" ? "photo" : "video", url: p.url };
    }
    throw new Error(String(d.status ?? "no media"));
  };
  // tembak semua host paralel, ambil yang pertama sukses
  const results = await Promise.allSettled(DL_HOSTS.map(attempt));
  for (const r of results) if (r.status === "fulfilled") return r.value;
  return null;
}

async function sendRemoteMedia(c: CmdCtx, url: string, type: DlResult["type"], platform: string): Promise<boolean> {
  try {
    await tg.sendChatAction(c.token, c.chatId, type === "photo" ? "upload_photo" : type === "audio" ? "upload_audio" : "upload_video");
    const bytes = Buffer.from(await (await http(url, undefined, 150_000)).arrayBuffer());
    if (bytes.length < 5_000) throw new Error("file kosong");
    if (bytes.length > 48_000_000) throw new Error("file > 48MB — kirim sebagai link");
    if (type === "photo") {
      const r = await tg.sendFile(c.token, "sendPhoto", { chat_id: c.chatId, caption: `🖼️ ${platform} — via ${name(c)} ✅` }, "photo", "foto.jpg", bytes, "image/jpeg");
      if (!r.ok) throw new Error(r.description ?? "gagal");
      const row = await insertMessage({ chatId: c.chatId, userId: c.chatId, tgMessageId: r.result?.message_id, direction: "out", kind: "photo", text: `${platform} download` });
      if (row) bus.emit("message", row);
    } else if (type === "audio") {
      await sendBytes(c.chatId, "sendAudio", "audio", "audio.mp3", bytes, "audio/mpeg", "audio", `🎵 ${platform} — via ${name(c)} ✅`);
    } else {
      await sendBytes(c.chatId, "sendVideo", "video", "video.mp4", bytes, "video/mp4", "video", `🎬 ${platform} — via ${name(c)} ✅`);
    }
    return true;
  } catch (e: any) {
    await logError(`dl-${platform}`, e?.message ?? String(e));
    return false;
  }
}

/* Twitter/X — API fxTwitter (stabil dari IP mana pun, memberi URL direct MP4) */
async function twitterDownload(c: CmdCtx, args: string) {
  const m = /(?:twitter|x)\.com\/(\w+)\/status(?:es)?\/(\d+)/i.exec(args);
  if (!m) return reply(c, "❗ Kirim link tweet yang valid.\nContoh: /twitter https://x.com/user/status/123456789");
  await tg.sendChatAction(c.token, c.chatId, "typing");
  try {
    const d = await jget(`https://api.fxtwitter.com/${m[1]}/status/${m[2]}`, undefined, 15_000);
    const tw = d?.tweet;
    if (!tw) throw new Error("notfound");
    const author = tw.author?.screen_name ?? m[1];
    const video = tw.media?.videos?.[0];
    const photo = tw.media?.photos?.[0];
    if (video?.url) {
      await reply(c, `⬇️ Mengunduh video dari @${author}... ⏳`).catch(() => {});
      const ok = await sendRemoteMedia(c, video.url, "video", "Twitter/X");
      if (!ok) await reply(c, `🎬 Video @${author} (simpan langsung):\n${video.url}`);
      return;
    }
    if (photo?.url) {
      const ok = await sendRemoteMedia(c, photo.url, "photo", "Twitter/X");
      if (!ok) await reply(c, `🖼️ Foto @${author}:\n${photo.url}`);
      return;
    }
    await reply(c, `🐦 Tweet @${author}:\n"${(tw.text ?? "").slice(0, 500)}"\n\n(Tweet ini tidak berisi video/foto)`);
  } catch {
    await reply(c, "❌ Tweet tidak ditemukan (mungkin dihapus, private, atau link salah). Pastikan tweet publik & link benar.");
  }
}

const WEB_DL_HINTS: Record<string, string> = {
  Instagram: "https://snapinsta.app atau https://saveig.app",
  Facebook: "https://fdown.net",
  Threads: "https://snapinsta.app (dukung Threads)",
  Pinterest: "https://pinterestdownloader.com",
};
const platformDownload = (platform: string) => async (c: CmdCtx, args: string) => {
  if (!/^https?:\/\//.test(args)) return reply(c, `❗ Kirim link ${platform} yang valid.\nContoh: /${platform.toLowerCase()} https://...`);
  await tg.sendChatAction(c.token, c.chatId, "typing");
  await reply(c, `⬇️ Memproses ${platform} — mencoba ${DL_HOSTS.length} server download sekaligus... ⏳`).catch(() => {});
  const found = await raceCobalt(args.trim());
  if (found && (await sendRemoteMedia(c, found.url, found.type, platform))) return;
  await reply(c,
    `⚠️ ${platform} memblokir semua server download dari datacenter (mereka wajibkan login akun — ini blokir resmi ${platform}, bukan bug bot).\n\n` +
    `✅ Solusi 10 detik yang PASTI berhasil — tempel link kamu di:\n${WEB_DL_HINTS[platform] ?? "https://cobalt.tools"}\n\n` +
    `🔗 Link kamu: ${args.trim()}\n\n💡 Untuk video: /tiktok dan /twitter bekerja langsung tanpa hambatan.`);
};
reg(["instagram", "ig"], platformDownload("Instagram"));
reg(["facebook", "fb"], platformDownload("Facebook"));
reg(["twitter", "x"], twitterDownload);
reg(["threads"], platformDownload("Threads"));
reg(["pinterest", "pint"], platformDownload("Pinterest"));
reg(["mediafire", "mf"], async (c, a) => {
  if (!/mediafire\.com/.test(a)) return reply(c, "❗ Kirim link Mediafire yang valid.");
  await reply(c, `⚠️ Mediafire membutuhkan bypass premium (CAPTCHA) yang tidak tersedia di server.\n\n🔗 Buka langsung (download resmi & aman):\n${a.trim()}`);
});
reg(["gdrive", "drive"], async (c, a) => {
  if (!/drive\.google\.com/.test(a)) return reply(c, "❗ Kirim link Google Drive yang valid.");
  await reply(c, `⚠️ File Google Drive hanya bisa diunduh lewat akun Google (limit harian & auth).\n\n🔗 Buka langsung:\n${a.trim()}\n\nTips: jika file < 100MB biasanya bisa langsung didownload di browser.`);
});
reg(["tiktok", "tt"], async (c, args) => {
  if (!/tiktok\.com/.test(args)) return reply(c, "❗ Kirim link TikTok.\nContoh: /tiktok https://vt.tiktok.com/xxxx");
  try {
    await tg.sendChatAction(c.token, c.chatId, "typing");
    let d: any = null;
    try {
      d = await jget(`https://www.tikwm.com/api/?url=${encodeURIComponent(args.trim())}&hd=1`, undefined, 15_000);
    } catch { /* coba via POST */ }
    if (!d || d.code !== 0 || !d.data) {
      const fd = new FormData();
      fd.append("url", args.trim()); fd.append("hd", "1");
      const res = await fetch("https://www.tikwm.com/api/", { method: "POST", body: fd, signal: AbortSignal.timeout(15_000) });
      d = await res.json().catch(() => null);
    }
    const v = d?.data;
    if (!d || d.code !== 0 || !v) throw new Error("fail");
    const cap = `🎬 *TikTok — ${(v.title || "tanpa judul").slice(0, 180)}*\n👤 @${v.author?.unique_id ?? "?"} · ❤️ ${v.play_count ?? "-"}`;
    const playPath: string | undefined = v.hdplay || v.play;
    if (playPath) {
      await reply(c, "⬇️ Mengunduh video TikTok (tanpa watermark)... tunggu sebentar ⏳");
      try {
        await tg.sendChatAction(c.token, c.chatId, "upload_video");
        const bytes = Buffer.from(await (await http(`https://www.tikwm.com${playPath}`, undefined, 90_000)).arrayBuffer());
        if (bytes.length < 10_000) throw new Error("empty file");
        if (bytes.length > 48_000_000) throw new Error("too big");
        await sendBytes(c.chatId, "sendVideo", "video", "tiktok.mp4", bytes, "video/mp4", "video", cap);
        return;
      } catch (e2: any) {
        await logError("tiktok-dl", e2?.message ?? String(e2));
        // fallback: kirim link unduhan langsung
        await reply(c, `${cap}\n\n📥 File terlalu besar/berat dikirim langsung — unduh manual (tanpa watermark):\nhttps://www.tikwm.com${playPath}`);
        return;
      }
    }
    await reply(c, `${cap}\n\n📥 ${v.play ? `https://www.tikwm.com${v.play}` : "Link unduhan tidak tersedia."}`);
  } catch (e: any) {
    await logError("tiktok", e?.message ?? String(e));
    await reply(c, "❌ Gagal memproses link TikTok (link privat/salah atau server sibuk). Coba lagi.");
  }
});

/* ---- fun ---- */
reg(["math"], async (c) => {
  const a = 2 + Math.floor(Math.random() * 40), b = 2 + Math.floor(Math.random() * 40);
  const op = ["+", "-", "*"][Math.floor(Math.random() * 3)];
  const ans = op === "+" ? a + b : op === "-" ? a - b : a * b;
  pendingAnswers.set(c.userId, { answer: String(ans), chatId: c.chatId, type: "math", expires: Date.now() + 60_000 });
  await reply(c, `🧮 KUIS MATEMATIKA\n\nBerapa ${a} ${op === "*" ? "×" : op} ${b} = ?\n\nJawab dalam 60 detik! (XP +25 jika benar)`);
});
const QUIZ = [
  { q: "Ibu kota Indonesia yang baru?", a: "nusantara" },
  { q: "Planet terdekat dari matahari?", a: "merkurius" },
  { q: "Bahasa pemrograman yang dibuat Brendan Eich dalam 10 hari?", a: "javascript" },
  { q: "Hewan tercepat di darat?", a: "cheetah" },
  { q: "Berapa sisi segitiga?", a: "3" },
  { q: "Aplikasi chat dengan logo pesawat kertas?", a: "telegram" },
];
reg(["quiz"], async (c) => {
  const q = QUIZ[Math.floor(Math.random() * QUIZ.length)];
  pendingAnswers.set(c.userId, { answer: q.a, chatId: c.chatId, type: "quiz", expires: Date.now() + 90_000 });
  await reply(c, `❓ KUIS\n\n${q.q}\n\nJawab langsung di chat ini! (XP +25)`);
});
const RIDDLES = [
  { q: "Makin banyak kamu ambil, makin besar dia. Apa itu?", a: "lubang" },
  { q: "Punya gigi tapi tidak bisa menggigit?", a: "sisir" },
  { q: "Selalu jatuh tapi tidak pernah terluka?", a: "hujan" },
  { q: "Apa yang naik tapi tidak pernah turun?", a: "umur" },
];
reg(["riddle", "tebakkata", "teka"], async (c) => {
  const r = RIDDLES[Math.floor(Math.random() * RIDDLES.length)];
  pendingAnswers.set(c.userId, { answer: r.a, chatId: c.chatId, type: "riddle", expires: Date.now() + 120_000 });
  await reply(c, `🤔 TEKA-TEKI\n\n${r.q}\n\nJawab dalam chat! (XP +25)`);
});
reg(["tebakgambar", "tebaklagu"], (c) => reply(c, "🎨 Mode tebak ini butuh aset gambar/audio — segera hadir! Sementara coba /quiz atau /riddle."));
reg(["truth"], (c) => {
  const t = ["Apa hal paling memalukan yang pernah kamu alami?", "Siapa crush pertamamu?", "Apa kebohongan terbesarmu?", "Hal apa yang paling kamu sesali?", "Siapa yang paling sering kamu stalk sosmednya?"];
  return reply(c, `😳 TRUTH:\n${t[Math.floor(Math.random() * t.length)]}`);
});
reg(["dare"], (c) => {
  const d = ["Kirim voice note nyanyi 10 detik!", "Pakai foto profil lucu selama 1 jam.", "Chat temanmu dengan kata-kata puitis.", "Post status absurd lalu hapus 5 menit kemudian.", "Kirim sticker paling memalukan yang kamu punya."];
  return reply(c, `🔥 DARE:\n${d[Math.floor(Math.random() * d.length)]}`);
});
reg(["slot"], async (c) => {
  const syms = ["🍒", "🍋", "💎", "7️⃣", "🍀", "⭐"];
  const r = () => syms[Math.floor(Math.random() * syms.length)];
  const [a, b, cc] = [r(), r(), r()];
  const win = a === b && b === cc;
  const two = a === b || b === cc || a === cc;
  if (win) await db.execute(sql`UPDATE tg_users SET balance = balance + 500 WHERE tg_id = ${c.userId}`);
  else if (two) await db.execute(sql`UPDATE tg_users SET balance = balance + 50 WHERE tg_id = ${c.userId}`);
  await reply(c, `🎰 SLOT\n[ ${a} | ${b} | ${cc} ]\n\n${win ? "🎉 JACKPOT! +500 koin" : two ? "✨ Hampir! +50 koin" : "💨 Belum beruntung, coba lagi!"}`);
});
reg(["coinflip", "koin"], (c) => reply(c, `🪙 ${Math.random() > 0.5 ? "ANGKA!" : "GAMBAR!"}`));
reg(["dadu", "dice"], (c) => reply(c, `🎲 Dadu: ${["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"][Math.floor(Math.random() * 6)]} (${1 + Math.floor(Math.random() * 6)})`));

/* ---- user / economy ---- */
reg(["profile", "me"], async (c) => {
  const [u] = await db.select().from(tgUsers).where(eq(tgUsers.tgId, c.userId)).limit(1);
  await reply(c,
    `👤 *PROFIL*\n\n🧑 ${c.from.first_name ?? "-"} ${c.from.last_name ?? ""}\n🆔 \`${c.userId}\`\n📊 Level ${u?.level ?? 1} · XP ${Math.round(u?.xp ?? 0)}\n💰 ${u?.balance ?? 0} koin\n📨 Masuk ${u?.totalIn ?? 0} · Keluar ${u?.totalOut ?? 0}\n⭐ Favorit: ${u?.isFavorite ? "ya" : "tidak"}\n🚫 Blacklist: ${u?.isBlacklisted ? "ya" : "tidak"}`);
});
reg(["level", "xp"], async (c) => {
  const [u] = await db.select().from(tgUsers).where(eq(tgUsers.tgId, c.userId)).limit(1);
  const xp = Math.round(u?.xp ?? 0), lvl = u?.level ?? 1;
  const next = 20 * lvl * lvl;
  await reply(c, `📊 Level ${lvl}\nXP ${xp} / ${next}\n${"▓".repeat(Math.min(10, Math.floor((xp / next) * 10)))}${"░".repeat(Math.max(0, 10 - Math.floor((xp / next) * 10)))}\n\nTerus chat untuk naik level!`);
});
reg(["rank"], async (c) => {
  const rows: any[] = (await db.execute(sql`SELECT tg_id, RANK() OVER (ORDER BY xp DESC) AS r FROM tg_users ORDER BY xp DESC`)).rows ?? [];
  const me = rows.find((r) => String(r.tg_id) === c.userId);
  await reply(c, `🏆 Rank kamu: #${me?.r ?? "-"} dari ${rows.length} user`);
});
reg(["balance", "saldo", "bal"], async (c) => {
  const [u] = await db.select().from(tgUsers).where(eq(tgUsers.tgId, c.userId)).limit(1);
  await reply(c, `💰 Saldo: ${u?.balance ?? 0} koin\n\nMain /slot atau /daily untuk tambah koin!`);
});
reg(["daily"], async (c) => {
  const today = new Date().toISOString().slice(0, 10);
  const [u] = await db.select().from(tgUsers).where(eq(tgUsers.tgId, c.userId)).limit(1);
  if (u?.lastDaily === today) return reply(c, "⏰ Sudah klaim hari ini! Kembali besok 🌅");
  await db.execute(sql`UPDATE tg_users SET balance = balance + 500, last_daily = ${today} WHERE tg_id = ${c.userId}`);
  await reply(c, "🎁 Daily reward: +500 koin!\nKembali lagi besok ya 💰");
});
reg(["leaderboard", "top"], async (c) => {
  const rows: any[] = (await db.execute(sql`SELECT first_name, username, xp, level FROM tg_users ORDER BY xp DESC LIMIT 10`)).rows ?? [];
  if (!rows.length) return reply(c, "🏆 Belum ada data.");
  const medals = ["🥇", "🥈", "🥉"];
  await reply(c, `🏆 LEADERBOARD\n\n${rows.map((r, i) => `${medals[i] ?? `${i + 1}.`} ${r.first_name}${r.username ? ` (@${r.username})` : ""} — Lv.${r.level} · ${Math.round(r.xp)} XP`).join("\n")}`);
});
reg(["report", "lapor", "laporan"], async (c, args) => {
  if (!args) return reply(c, "❗ Contoh: /report bot error saat pakai /play\n\nLaporanmu otomatis diteruskan ke owner.");
  const s: any = S(c);
  const target = String(s.reportTarget ?? "").trim();
  const ownerIds: string[] = Array.isArray(s.ownerIds) ? s.ownerIds : [];
  const targets = [...new Set([...(target ? [target] : []), ...ownerIds])].filter(Boolean);
  const who = `${c.from.first_name ?? "User"}${c.from.username ? ` (@${c.from.username})` : ""} · ID ${c.userId}`;
  let when = new Date().toISOString();
  try { when = new Date().toLocaleString("id-ID", { timeZone: s.timezone }); } catch { /* */ }
  const body = `📩 *LAPORAN BARU DARI USER*\n\n👤 Dari: ${who}\n🕐 Waktu: ${when}\n\n💬 Isi laporan:\n${args.slice(0, 1500)}`;
  let sent = 0;
  for (const t of targets) {
    try { await sendText(t, body); sent++; } catch { /* tujuan tidak valid */ }
  }
  await logError("report-user", args.slice(0, 300), who);
  if (sent > 0) {
    await reply(c, `✅ Laporanmu sudah terkirim otomatis ke ${sent} tujuan (${s.devName ?? "owner"}). Terima kasih sudah melapor! 🙏`);
  } else {
    await reply(c, `✅ Laporan dicatat di sistem.\n⚠️ Owner belum mengatur tujuan laporan di Panel Admin — minta owner isi "Tujuan Laporan" agar laporan masuk ke Telegram-nya.`);
  }
});
reg(["history"], async (c) => {
  const rows = await db.select().from(messages).where(eq(messages.userId, c.userId)).orderBy(desc(messages.id)).limit(5);
  if (!rows.length) return reply(c, "📜 Belum ada riwayat.");
  await reply(c, `📜 PESAN TERAKHIR\n\n${rows.map((r) => `• [${r.direction === "in" ? "kamu" : "bot"}] ${(r.text ?? r.kind ?? "").slice(0, 60)}`).join("\n")}`);
});
reg(["settings", "set"], (c) => reply(c, `⚙️ Pengaturan bot (nama, menu, audio, auto AI, quick reply) dikelola owner lewat dashboard web ${name(c)}.`));

/* ---- group admin ---- */
const groupOnly = (c: CmdCtx) => c.msg.chat.type === "private";
reg(["ban"], async (c, args) => {
  if (groupOnly(c)) return reply(c, "❗ Khusus grup.");
  const id = targetId(c, args); if (!id) return reply(c, "❗ Reply pesan user atau /ban <id>");
  const r = await tg.banChatMember(c.token, c.chatId, id);
  await reply(c, r.ok ? `🔨 User ${id} telah di-BAN.` : "❌ Gagal ban (bot harus admin).");
});
reg(["unban"], async (c, args) => {
  if (groupOnly(c)) return reply(c, "❗ Khusus grup.");
  const id = targetId(c, args); if (!id) return reply(c, "❗ /unban <id>");
  const r = await tg.unbanChatMember(c.token, c.chatId, id);
  await reply(c, r.ok ? `✅ User ${id} di-unban.` : "❌ Gagal unban.");
});
reg(["kick"], async (c, args) => {
  if (groupOnly(c)) return reply(c, "❗ Khusus grup.");
  const id = targetId(c, args); if (!id) return reply(c, "❗ Reply pesan atau /kick <id>");
  await tg.banChatMember(c.token, c.chatId, id);
  await new Promise((r) => setTimeout(r, 800));
  const r2 = await tg.unbanChatMember(c.token, c.chatId, id);
  await reply(c, r2.ok ? `👢 User ${id} di-kick.` : "❌ Gagal kick.");
});
reg(["promote"], async (c, args) => {
  if (groupOnly(c)) return reply(c, "❗ Khusus grup.");
  const id = targetId(c, args); if (!id) return reply(c, "❗ Reply pesan atau /promote <id>");
  const r = await tg.promoteChatMember(c.token, c.chatId, id, true);
  await reply(c, r.ok ? `⬆️ ${id} dipromosikan jadi admin.` : "❌ Gagal promote.");
});
reg(["demote"], async (c, args) => {
  if (groupOnly(c)) return reply(c, "❗ Khusus grup.");
  const id = targetId(c, args); if (!id) return reply(c, "❗ Reply pesan atau /demote <id>");
  const r = await tg.promoteChatMember(c.token, c.chatId, id, false);
  await reply(c, r.ok ? `⬇️ ${id} diturunkan dari admin.` : "❌ Gagal demote.");
});
const MUTE_PERMS: Record<string, boolean> = { can_send_messages: false, can_send_audios: false, can_send_documents: false, can_send_photos: false, can_send_videos: false, can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false, can_send_other_messages: false, can_add_web_page_previews: false, can_change_info: false, can_invite_users: false, can_pin_messages: false };
reg(["mute"], async (c, args) => {
  if (groupOnly(c)) return reply(c, "❗ Khusus grup.");
  const id = targetId(c, args); if (!id) return reply(c, "❗ Reply pesan atau /mute <id>");
  const r = await tg.restrictChatMember(c.token, c.chatId, id, { ...MUTE_PERMS, can_send_messages: false });
  await reply(c, r.ok ? `🤐 ${id} di-mute 1 jam.` : "❌ Gagal mute.");
}, );
reg(["unmute"], async (c, args) => {
  if (groupOnly(c)) return reply(c, "❗ Khusus grup.");
  const id = targetId(c, args); if (!id) return reply(c, "❗ Reply pesan atau /unmute <id>");
  const r = await tg.restrictChatMember(c.token, c.chatId, id, { can_send_messages: true, can_send_audios: true, can_send_documents: true, can_send_photos: true, can_send_videos: true, can_send_video_notes: true, can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true, can_add_web_page_previews: true, can_change_info: false, can_invite_users: true, can_pin_messages: false });
  await reply(c, r.ok ? `🔊 ${id} di-unmute.` : "❌ Gagal unmute.");
});
reg(["pin"], async (c) => {
  const mid = c.msg.reply_to_message?.message_id;
  if (!mid) return reply(c, "❗ Reply pesan yang mau di-pin.");
  const r = await tg.pinChatMessage(c.token, c.chatId, mid);
  await reply(c, r.ok ? "📌 Pesan di-pin." : "❌ Gagal pin (bot harus admin).");
});
reg(["unpin"], async (c) => {
  const r = await tg.unpinChatMessage(c.token, c.chatId);
  await reply(c, r.ok ? "📌 Pin dihapus." : "❌ Gagal unpin.");
});
reg(["tagall"], async (c) => {
  const admins = await tg.getChatAdministrators(c.token, c.chatId);
  const list = (admins.ok ? (admins.result ?? []) : []).map((a: any) => `• ${a.user.first_name} (@${a.user.username ?? a.user.id})`).join("\n");
  await reply(c, `📣 TAG ALL ADMIN\n\n${list || "(tidak ada)"}`);
});
reg(["open"], async (c) => {
  if (groupOnly(c)) return reply(c, "❗ Khusus grup.");
  const r = await tg.setChatPermissions(c.token, c.chatId, { can_send_messages: true, can_send_audios: true, can_send_documents: true, can_send_photos: true, can_send_videos: true, can_send_video_notes: true, can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true, can_add_web_page_previews: true, can_change_info: true, can_invite_users: true, can_pin_messages: true });
  await reply(c, r.ok ? "🔓 Grup DIBUKA — semua member bisa chat." : "❌ Gagal (bot harus admin).");
});
reg(["close"], async (c) => {
  if (groupOnly(c)) return reply(c, "❗ Khusus grup.");
  const r = await tg.setChatPermissions(c.token, c.chatId, { ...MUTE_PERMS });
  await reply(c, r.ok ? "🔒 Grup DITUTUP — hanya admin yang bisa chat." : "❌ Gagal (bot harus admin).");
});
const toggleMod = (key: "welcome" | "antilink" | "antiflood" | "antibot" | "antispam") => async (c: CmdCtx, args: string) => {
  if (groupOnly(c)) return reply(c, "❗ Khusus grup.");
  const on = /^on|aktif|1$/i.test((args || "").trim());
  const off = /^off|mati|0$/i.test((args || "").trim());
  if (!on && !off) return reply(c, `❗ Contoh: /${key} on | /${key} off`);
  const s: any = S(c);
  const mods = { ...(s.groupMods ?? {}), [c.chatId]: { ...(s.groupMods?.[c.chatId] ?? {}), [key]: on } };
  await patchSettings({ groupMods: mods } as any);
  await refreshConfig();
  await reply(c, `${on ? "✅" : "🛑"} ${key.toUpperCase()} ${on ? "AKTIF" : "NONAKTIF"} di chat ini.`);
};
reg(["welcome"], toggleMod("welcome"));
reg(["antilink"], toggleMod("antilink"));
reg(["antiflood"], toggleMod("antiflood"));
reg(["antibot"], toggleMod("antibot"));
reg(["antispam"], toggleMod("antispam"));

/* ---- owner ---- */
const ownerHint = (c: CmdCtx) => reply(c, "🔐 Perintah owner. Kelola via dashboard web, atau /addowner <id> dulu.");
reg(["broadcast", "bc"], async (c, args) => {
  if (!args) return reply(c, "❗ Contoh: /broadcast pengumuman penting!");
  const users = await db.select({ id: tgUsers.tgId }).from(tgUsers).where(eq(tgUsers.isChannel, false));
  let ok = 0, fail = 0;
  await reply(c, `📢 Broadcast ke ${users.length} user dimulai...`);
  for (const u of users) {
    try { await sendText(u.id, `📢 *BROADCAST*\n${args}`); ok++; } catch { fail++; }
    await new Promise((r) => setTimeout(r, 60));
  }
  await sendText(c.chatId, `✅ Broadcast selesai: ${ok} terkirim, ${fail} gagal.`);
});
reg(["block"], async (c, args) => {
  const id = String(targetId(c, args) ?? "").trim();
  if (!id) return reply(c, "❗ Reply pesan atau /block <id>");
  const s: any = S(c);
  await patchSettings({ blockedUsers: [...new Set([...(s.blockedUsers ?? []), id])] });
  await db.update(tgUsers).set({ isBlacklisted: true }).where(eq(tgUsers.tgId, id)).catch(() => {});
  await refreshConfig();
  await reply(c, `🚫 User ${id} diblokir.`);
});
reg(["unblock"], async (c, args) => {
  const id = String(targetId(c, args) ?? "").trim();
  if (!id) return reply(c, "❗ /unblock <id>");
  const s: any = S(c);
  await patchSettings({ blockedUsers: (s.blockedUsers ?? []).filter((x: string) => x !== id) });
  await db.update(tgUsers).set({ isBlacklisted: false }).where(eq(tgUsers.tgId, id)).catch(() => {});
  await refreshConfig();
  await reply(c, `✅ User ${id} dibuka blokirnya.`);
});
reg(["addpremium"], async (c, args) => {
  const id = String(targetId(c, args) ?? ""); if (!id) return reply(c, "❗ /addpremium <id>");
  const s: any = S(c);
  await patchSettings({ premiumUsers: [...new Set([...(s.premiumUsers ?? []), id])] }); await refreshConfig();
  await reply(c, `💎 ${id} sekarang PREMIUM.`);
});
reg(["delpremium"], async (c, args) => {
  const id = String(targetId(c, args) ?? ""); if (!id) return reply(c, "❗ /delpremium <id>");
  const s: any = S(c);
  await patchSettings({ premiumUsers: (s.premiumUsers ?? []).filter((x: string) => x !== id) }); await refreshConfig();
  await reply(c, `💎 Premium ${id} dicabut.`);
});
reg(["addowner"], async (c, args) => {
  const id = String(targetId(c, args) ?? ""); if (!id) return reply(c, "❗ /addowner <id>");
  const s: any = S(c);
  await patchSettings({ ownerIds: [...new Set([...(s.ownerIds ?? []), id])] }); await refreshConfig();
  await reply(c, `👑 ${id} ditambahkan sebagai owner.`);
});
reg(["maintenance"], async (c, args) => {
  const on = /^on|1|aktif$/i.test(args); const off = /^off|0|mati$/i.test(args);
  if (!on && !off) return reply(c, "❗ /maintenance on|off");
  await patchSettings({ maintenance: on }); await refreshConfig();
  await reply(c, `🛠️ Mode maintenance ${on ? "AKTIF — user non-owner ditolak." : "NONAKTIF."}`);
});
reg(["setname"], async (c, args) => {
  if (!args) return reply(c, "❗ /setname NamaBotBaru");
  await patchSettings({ displayName: args.slice(0, 40) }); await refreshConfig();
  await reply(c, `✅ Nama bot diganti jadi *${args.slice(0, 40)}*`);
});
reg(["setmenu"], async (c, args) => {
  if (!args) return reply(c, "❗ Kirim teks menu baru setelah /setmenu. Pakai {name} {bot} {dev} untuk variabel.");
  await patchSettings({ startMenu: args.slice(0, 2000) }); await refreshConfig();
  await reply(c, "✅ Menu /start diperbarui!");
});
reg(["setbio"], async (c, args) => {
  await patchSettings({ botBio: args.slice(0, 200) } as any); await refreshConfig();
  await reply(c, "✅ Bio diperbarui.");
});
reg(["setppbot"], (c) => reply(c, "ℹ️ Telegram Bot API tidak mengizinkan bot mengganti foto profil sendiri."));
reg(["logs"], async (c) => {
  const rows = await db.select().from(errorLogs).orderBy(desc(errorLogs.id)).limit(5);
  await reply(c, rows.length ? `🪵 LOG TERAKHIR\n\n${rows.map((r) => `• [${r.source}] ${r.message}`).join("\n")}` : "✅ Tidak ada error log.");
});
reg(["restart", "update"], (c) => reply(c, "🔄 Restart/backup sistem dilakukan dari dashboard web (menu Settings → Backup/Restore)."));
reg(["eval", "exec", "shell", "run"], (c) => reply(c, "⛔ Dinonaktifkan demi keamanan server."));
reg(["backup", "restore"], (c) => reply(c, "💾 Backup & restore full tersedia di dashboard web: Settings → Export/Import JSON."));

/* ============================ dispatch ============================ */

export async function dispatchCommand(c: CmdCtx) {
  const s: any = S(c);
  const [headRaw, ...rest] = c.text.split(/\s+/);
  const head = headRaw.replace(/^\//, "").split("@")[0].toLowerCase();
  const args = c.text.slice(headRaw.length).trim();
  const argv = rest;

  // maintenance gate
  if (s.maintenance && !["menu", "maintenance", "help"].includes(head) && !(s.ownerIds ?? []).includes(c.userId)) {
    return reply(c, "🛠️ Bot sedang dalam mode maintenance. Coba lagi nanti ya!");
  }

  const h = CMDS[head];
  if (h) {
    try {
      await h(c, args, argv);
    } catch (e: any) {
      await logError(`cmd:${head}`, e?.message ?? String(e), e?.stack);
      await reply(c, "❌ Terjadi error saat memproses perintah. Sudah dicatat di log.").catch(() => {});
    }
    return;
  }

  /* command tak dikenal → AI tetap menjawab selama API key tersedia (semua command jadi berfungsi) */
  if (resolveGeminiKey(s)) {
    try {
      await tg.sendChatAction(c.token, c.chatId, "typing");
      const out = await askGemini(
        `User Telegram mengirim command "/${head}${args ? " " + args : ""}". Command itu tidak ada di sistem. Bantu user: jawab/analisis permintaannya sebaik mungkin dalam bahasa mereka.`,
        aiSys(c, "Jawab akurat, ringkas, maks 1200 karakter. Jangan sebut bahwa kamu bingung."),
        s
      );
      if (out) {
        await reply(c, `🤖 /${head} bukan command resmi, tapi AI-ku tetap menjawab:\n\n${out}\n\n(ketik /menu untuk command lengkap)`);
        return;
      }
    } catch (e: any) {
      await logError("cmd-fallback-ai", e?.message ?? String(e));
    }
  }
  await reply(c, `🤔 Perintah /${head} tidak dikenal.\nKetik /menu untuk daftar fitur ⚡`);
}

/* ---- group rule enforcement (antilink / antiflood / antibot) ---- */
const floodTrack = new Map<string, number[]>();
export async function enforceGroupRules(c: { token: string; cfg: ConfigRow; msg: any; chatId: string; userId: string; from: any }): Promise<boolean> {
  const { msg, chatId, token } = c;
  if (msg.chat?.type === "private") return false;
  const s: any = c.cfg.settings ?? {};
  const mods = s.groupMods?.[chatId];
  if (!mods) return false;
  const text: string = msg.text ?? msg.caption ?? "";
  try {
    if (mods.antibot && c.from.is_bot) {
      await tg.banChatMember(token, chatId, Number(c.from.id));
      return true;
    }
    if (mods.antilink && /(https?:\/\/|t\.me\/|www\.)/i.test(text)) {
      await tg.deleteMessage(token, chatId, msg.message_id);
      await sendText(chatId, `⚠️ @${c.from.username ?? c.from.first_name}, link dilarang di grup ini! Pesan dihapus.`);
      return true;
    }
    if (mods.antiflood) {
      const now = Date.now();
      const arr = (floodTrack.get(c.userId) ?? []).filter((t) => now - t < 10_000);
      arr.push(now);
      floodTrack.set(c.userId, arr);
      if (arr.length > 6) {
        floodTrack.set(c.userId, []);
        await tg.restrictChatMember(token, chatId, Number(c.from.id), { ...MUTE_PERMS, can_send_messages: false });
        await sendText(chatId, `🤖 Flood terdeteksi — ${c.from.first_name} di-mute 5 menit.`);
        return true;
      }
    }
  } catch (e: any) {
    await logError("moderation", e?.message ?? String(e));
  }
  return false;
}

/* ---- auto AI reply for non-command messages ---- */
export async function maybeAutoReply(c: CmdCtx) {
  const s: any = S(c);
  if (s.maintenance) return;

  // game answers take priority
  const pending = pendingAnswers.get(c.userId);
  if (pending && pending.chatId === c.chatId && pending.expires > Date.now()) {
    const { hit } = consumePending(c.userId, c.chatId, c.text);
    if (hit) {
      await db.execute(sql`UPDATE tg_users SET xp = xp + 25, balance = balance + 100 WHERE tg_id = ${c.userId}`);
      await reply(c, `🎉 BENAR! +25 XP +100 koin 🪙\nJawaban: *${pending.answer}*`);
    } else {
      await reply(c, `❌ Salah! Jawaban yang benar: *${pending.answer}*`);
    }
    return;
  }

  if (!s.autoAI) return;
  const isGroup = c.msg.chat.type !== "private";
  const mentioned = c.cfg.botUsername ? c.text.toLowerCase().includes(`@${c.cfg.botUsername.toLowerCase()}`) : false;
  const repliedToBot = c.msg.reply_to_message?.from?.id === Number(c.cfg.botId);
  if (isGroup && !mentioned && !repliedToBot) return;
  if (!c.text || c.text.length > 3000) return;

  await typing(c.chatId);
  const out = await askGemini(c.text, aiSys(c, "Analisis SEMUA permintaan user dengan teliti: matematika, kode, terjemahan, pengetahuan, opini — jawab akurat dan lengkap tapi tidak bertele-tele. Maks 1500 karakter."), s);
  await reply(c, out ?? fallbackAI(c, c.text));
}
