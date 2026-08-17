"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/client";
import { IconTelegram, IconEye, IconBolt, IconChat, IconBot, IconLock } from "@/components/icons";

type State = { s: "idle" } | { s: "loading" } | { s: "error"; msg: string } | { s: "ok"; data?: any };

export default function ConnectView({ onConnected }: { onConnected: () => Promise<void> | void }) {
  const [sessionId, setSessionId] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [token, setToken] = useState("");
  const [phone, setPhone] = useState("");
  const [show, setShow] = useState(false);
  const [wa, setWa] = useState<any>({});
  const [sessions, setSessions] = useState<any[]>([]);
  const [st, setSt] = useState<State>({ s: "idle" });

  const currentSessionKey = sessionId || `session-${Math.random().toString(36).substring(2, 8)}`;

  const loadSessions = async () => {
    try {
      const r = await api.get<any>("/api/sessions");
      if (r.sessions) setSessions(r.sessions);
    } catch {}
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const handleCreateSession = async () => {
    if (!token.trim()) { setSt({ s: "error", msg: "❌ Masukkan Telegram Bot Token terlebih dahulu." }); return; }
    setSt({ s: "loading" });
    try {
      const r = await api.post<any>("/api/sessions", {
        action: "create",
        sessionId: currentSessionKey,
        ownerName: ownerName || "My Bot",
        telegramToken: token.trim(),
      });
      setSt({ s: "ok", data: r });
      await loadSessions();
      setTimeout(() => onConnected(), 800);
    } catch (e: any) {
      setSt({ s: "error", msg: e?.message ?? "❌ Gagal membuat sesi bot." });
    }
  };

  const waAction = async (action: string, extra: any = {}) => {
    setSt({ s: "loading" });
    try {
      const r = await api.post<any>("/api/sessions", {
        action,
        sessionId: currentSessionKey,
        ...extra,
      });
      if (r.wa) setWa(r.wa);
      setSt({ s: "ok", data: r });
      if (r.wa?.connected) setTimeout(() => onConnected(), 800);
    } catch (e: any) {
      setSt({ s: "error", msg: e?.message ?? "❌ WhatsApp gagal diproses." });
    }
  };

  useEffect(() => {
    if (!currentSessionKey) return;
    let active = true;
    const poll = async () => {
      try {
        const r = await api.get<any>(`/api/sessions?sessionId=${currentSessionKey}`);
        if (active && r.wa) setWa(r.wa);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 1800);
    return () => { active = false; clearInterval(id); };
  }, [currentSessionKey]);

  return (
    <main className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-10">
      <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-[620px]">
        <div className="panel neon relative overflow-hidden p-7 sm:p-9 shadow-[0_0_40px_-10px_rgba(56,189,248,0.25)]">
          <div className="mb-6 flex items-center justify-between border-b border-[var(--line)] pb-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-glow sm:text-[26px]">Multi-User & Multi-Session</h1>
              <p className="mt-1 text-xs text-[var(--muted)]">Gunakan bot Telegram dan WhatsApp (Baileys 6.7.18) tanpa batas untuk setiap user.</p>
            </div>
            <span className="chip font-mono2 text-[10px]">Tanpa Batas</span>
          </div>

          {sessions.length > 0 && (
            <div className="mb-5">
              <label className="mb-1.5 block font-mono2 text-[10.5px] uppercase tracking-[0.2em] text-[var(--faint)]">Pilih Sesi Aktif atau Buat Baru</label>
              <select className="input font-mono2 text-xs" value={sessionId} onChange={e => setSessionId(e.target.value)}>
                <option value="">+ Buat Sesi Baru</option>
                {sessions.map(s => (
                  <option key={s.sessionKey} value={s.sessionKey}>
                    {s.ownerName} ({s.sessionKey}) {s.telegramActive ? "· [Telegram]" : ""} {s.whatsappConnected ? "· [WhatsApp]" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block font-mono2 text-[10.5px] uppercase tracking-[0.2em] text-[var(--faint)]">Nama Pemilik / Bot</label>
              <input className="input mt-1" placeholder="Contoh: Admin Store" value={ownerName} onChange={e => setOwnerName(e.target.value)} />
            </div>
            <div>
              <label className="block font-mono2 text-[10.5px] uppercase tracking-[0.2em] text-[var(--faint)]">ID Sesi Unik</label>
              <input className="input mt-1 font-mono2 text-xs" placeholder="otomatis / custom" value={sessionId} onChange={e => setSessionId(e.target.value)} />
            </div>
          </div>

          <div className="space-y-6 border-t border-[var(--line)] pt-6">
            {/* Telegram Section */}
            <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--panel2)] text-[var(--ok)]"><IconTelegram size={22} /></div>
                <div>
                  <h2 className="font-bold text-base">Koneksi Bot Telegram</h2>
                  <p className="text-xs text-[var(--muted)]">Masukkan token dari @BotFather</p>
                </div>
              </div>
              <div className="relative mt-2">
                <input className="input font-mono2 !pr-11 text-xs" type={show ? "text" : "password"} placeholder="123456789:AA..." value={token} onChange={e => setToken(e.target.value)} />
                <button type="button" onClick={() => setShow(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)]"><IconEye size={16} /></button>
              </div>
              <button className="btn btn-primary mt-3 w-full !text-xs" onClick={handleCreateSession} disabled={st.s === "loading"}>
                <IconBolt size={14} /> Aktifkan Sesi Telegram
              </button>
            </div>

            {/* WhatsApp Section */}
            <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--panel2)] text-[var(--ok)]"><IconChat size={22} /></div>
                <div>
                  <h2 className="font-bold text-base">WhatsApp Baileys 6.7.18</h2>
                  <p className="text-xs text-[var(--muted)]">QR Code asli atau Pairing Code tanpa batas</p>
                </div>
              </div>

              {!wa.connected && (
                <div className="space-y-3 mt-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input className="input font-mono2 text-xs" placeholder="No: 628123456789" value={phone} onChange={e => setPhone(e.target.value)} />
                    <button className="btn btn-primary text-xs" onClick={() => waAction("pair_wa", { phone })} disabled={st.s === "loading"}>
                      Pairing Code Asli
                    </button>
                  </div>
                  <button className="btn w-full !bg-[var(--panel2)] text-xs" onClick={() => waAction("connect_wa")} disabled={st.s === "loading"}>
                    Generate QR Code Asli
                  </button>
                </div>
              )}

              <div className="mt-4 flex min-h-[160px] items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--bg2)] p-3">
                {wa.connected ? (
                  <div className="text-center">
                    <div className="text-3xl">🟢</div>
                    <p className="mt-1 font-bold text-sm text-[var(--ok)]">WhatsApp Terhubung</p>
                    <p className="font-mono2 text-[11px] text-[var(--muted)]">{wa.phone || wa.jid}</p>
                  </div>
                ) : wa.qrDataUrl ? (
                  <div className="text-center">
                    <img src={wa.qrDataUrl} alt="QR Baileys" className="mx-auto h-48 w-48 rounded bg-white p-2" />
                    <p className="mt-1 font-mono2 text-[10px] text-[var(--muted)]">Scan dengan WhatsApp HP Anda</p>
                  </div>
                ) : wa.pairingCode ? (
                  <div className="text-center p-2">
                    <p className="text-[11px] text-[var(--muted)]">Masukkan kode pairing ini di WhatsApp → Perangkat Tertaut:</p>
                    <div className="mt-2 rounded bg-[var(--bg)] py-2 px-3 border border-[var(--line2)]">
                      <span className="font-mono2 text-2xl font-bold tracking-[0.18em] text-[var(--ok)]">{wa.pairingCode}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-center text-xs text-[var(--muted)]">Pilih Generate QR atau Pairing Code di atas.</p>
                )}
              </div>

              {wa.connected && (
                <button className="btn btn-danger mt-3 w-full text-xs" onClick={() => waAction("disconnect_wa", { logout: true })}>
                  Putuskan Koneksi (Logout Sesi Ini)
                </button>
              )}
            </div>
          </div>

          <AnimatePresence mode="wait">
            {st.s === "error" && <motion.p key="err" initial={{opacity:0,y:-6}} animate={{opacity:1,y:0}} className="mt-4 rounded-lg border border-[var(--bad)]/30 bg-[var(--bad)]/10 px-3 py-2 text-xs font-semibold text-[var(--bad)]">{st.msg}</motion.p>}
            {st.s === "ok" && <motion.p key="ok" initial={{opacity:0,y:-6}} animate={{opacity:1,y:0}} className="mt-4 rounded-lg border border-[var(--ok)]/30 bg-[var(--ok)]/10 px-3 py-2 text-xs font-semibold text-[var(--ok)]">✅ Sesi berhasil disimpan dan diproses!</motion.p>}
          </AnimatePresence>
        </div>
      </motion.div>
    </main>
  );
}
