/* Client-side API helpers + shared types + formatters */

export interface BotInfo {
  id: string | null; name: string | null; username: string | null;
  description: string | null; mode: string; webhookUrl: string | null;
  tokenMasked: string | null; photoUrl: string | null;
  connectedAt: string | null; lastSyncAt: string | null; active: boolean | null;
}
export interface QuickReply { trigger: string; response: string; }
export interface Settings {
  displayName?: string; devName?: string; devPhone?: string; devTele?: string;
  startMenu?: string; startAudioUrl?: string; autoAI?: boolean; maintenance?: boolean;
  timezone?: string; language?: "id" | "en"; quickReplies?: QuickReply[];
  blockedUsers?: string[]; premiumUsers?: string[]; ownerIds?: string[];
}
export interface LiveStats {
  startedAt: number | null; processed: number; lastBatch: number;
  latencyMs: number; apiOnline: boolean; lastPingAt: number;
  latencyHistory?: number[];
}
export interface BootData {
  connected: boolean; bot: BotInfo | null; settings: Settings; live: LiveStats; admin: boolean;
}
export interface MsgRow {
  id: number; chatId: string; userId: string | null; tgMessageId: number | null;
  direction: "in" | "out"; kind: string | null; text: string | null; caption: string | null;
  replyTo: number | null; filePath: string | null; fileName: string | null;
  fileSize: number | null; mime: string | null; meta: Record<string, any> | null;
  createdAt: string;
}
export interface ChatRow {
  chat_id: string; text: string | null; caption: string | null; kind: string | null;
  direction: string; created_at: string; first_name: string | null; username: string | null;
  photo_path: string | null; is_favorite: boolean | null; is_blacklisted: boolean | null;
  is_pinned: boolean | null; is_archived: boolean | null; is_channel: boolean | null; total: number;
}
export interface UserRow {
  tgId: string; firstName: string | null; lastName: string | null; username: string | null;
  isChannel: boolean | null; photoPath: string | null; totalIn: number | null; totalOut: number | null;
  xp: number | null; level: number | null; balance: number | null;
  isFavorite: boolean | null; isBlacklisted: boolean | null; isPinned: boolean | null; isArchived: boolean | null;
  firstSeen: string | null; lastSeen: string | null;
}

/* Token admin disimpan di localStorage sebagai cadangan bila cookie diblokir proxy —
   dikirim lewat header x-admin-token di semua request */
function adminHeaders(): Record<string, string> {
  try {
    const t = localStorage.getItem("abm_admin_token");
    if (t) return { "x-admin-token": t };
  } catch { /* private mode */ }
  return {};
}
export function setAdminToken(token: string | null) {
  try {
    if (token) localStorage.setItem("abm_admin_token", token);
    else localStorage.removeItem("abm_admin_token");
  } catch { /* */ }
}

export const api = {
  async get<T>(url: string): Promise<T> {
    const r = await fetch(url, { cache: "no-store", headers: adminHeaders() });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error || `HTTP ${r.status}`);
    }
    return r.json();
  },
  async post<T>(url: string, body: unknown): Promise<T> {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders() }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d as T;
  },
  async upload<T>(url: string, form: FormData): Promise<T> {
    const r = await fetch(url, { method: "POST", headers: adminHeaders(), body: form });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d as T;
  },
};

/* ---------- formatters ---------- */
export function fmtTime(iso: string | null | undefined, tz?: string) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  } catch { return new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }); }
}
export function fmtDate(iso: string | null | undefined, tz?: string) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: tz });
  } catch { return new Date(iso).toLocaleDateString("id-ID"); }
}
export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "-";
  const s = Math.max(0, (Date.now() - +new Date(iso)) / 1000);
  if (s < 10) return "baru saja";
  if (s < 60) return `${Math.floor(s)}d lalu`;
  if (s < 3600) return `${Math.floor(s / 60)}m lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)}j lalu`;
  return `${Math.floor(s / 86400)}h lalu`;
}
export function fmtBytes(n: number | null | undefined) {
  if (!n) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
export function fileProxy(path: string | null | undefined) {
  return path ? `/api/file?path=${encodeURIComponent(path)}` : null;
}

/* ---------- tiny pub/sub for realtime events ---------- */
type Handler = (data: any) => void;
const listeners = new Map<string, Set<Handler>>();
export const ev = {
  on(type: string, fn: Handler) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(fn);
    return () => { listeners.get(type)?.delete(fn); };
  },
  emit(type: string, data: any) {
    listeners.get(type)?.forEach((fn) => fn(data));
    listeners.get("*")?.forEach((fn) => fn({ type, data }));
  },
};

/* ---------- notification beep (Web Audio, no asset needed) ---------- */
let audioCtx: AudioContext | null = null;
export function beep() {
  try {
    audioCtx = audioCtx ?? new AudioContext();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine"; o.frequency.value = 880;
    g.gain.setValueAtTime(0.001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.08, audioCtx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.28);
    o.connect(g).connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.3);
    setTimeout(() => {
      const o2 = audioCtx!.createOscillator(); const g2 = audioCtx!.createGain();
      o2.type = "sine"; o2.frequency.value = 1318;
      g2.gain.setValueAtTime(0.001, audioCtx!.currentTime);
      g2.gain.exponentialRampToValueAtTime(0.06, audioCtx!.currentTime + 0.02);
      g2.gain.exponentialRampToValueAtTime(0.0001, audioCtx!.currentTime + 0.25);
      o2.connect(g2).connect(audioCtx!.destination);
      o2.start(); o2.stop(audioCtx!.currentTime + 0.26);
    }, 120);
  } catch { /* audio diblokir browser */ }
}

export const EMOJIS = ["😀","😂","🤣","😊","😍","🥰","😎","🤩","😢","😭","😡","🤯","🥳","😴","🤔","👍","👎","👏","🙏","💪","🔥","⭐","❤️","💯","✅","❌","⚡","🎉","🎵","🎬","⚽","🏆","🚀","🤖","👻","💀","🙈","🤝","📌","💬","📷","🎁","☕","🍕","🌙","☀️","🌈","💎","🎮","📱"];
