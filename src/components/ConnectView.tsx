"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/client";
import { IconTelegram, IconEye, IconBolt, IconChat, IconBot, IconLock } from "@/components/icons";

type State = { s: "idle" } | { s: "loading" } | { s: "error"; msg: string } | { s: "ok"; bot?: any };

export default function ConnectView({ onConnected }: { onConnected: () => Promise<void> | void }) {
  const [tab, setTab] = useState<"telegram" | "whatsapp">("telegram");
  const [token, setToken] = useState("");
  const [phone, setPhone] = useState("");
  const [show, setShow] = useState(false);
  const [wa, setWa] = useState<any>({});
  const [st, setSt] = useState<State>({ s: "idle" });

  const connectTelegram = async () => {
    if (!token.trim()) { setSt({ s: "error", msg: "❌ Masukkan Bot Token terlebih dahulu." }); return; }
    setSt({ s: "loading" });
    try {
      const r = await api.post<{ ok: boolean; bot: any }>("/api/bot", { action: "connect", token: token.trim() });
      setSt({ s: "ok", bot: r.bot });
      setTimeout(() => onConnected(), 800);
    } catch (e: any) {
      setSt({ s: "error", msg: e?.message ?? "❌ Token Bot tidak valid." });
    }
  };

  const waAction = async (action: string, extra: any = {}) => {
    setSt({ s: "loading" });
    try {
      const r = await api.post<any>("/api/whatsapp", { action, ...extra });
      setWa(r);
      setSt({ s: "ok" });
      if (r.connected) setTimeout(() => onConnected(), 800);
    } catch (e: any) {
      setSt({ s: "error", msg: e?.message ?? "❌ WhatsApp gagal diproses." });
    }
  };

  useEffect(() => {
    if (tab !== "whatsapp") return;
    let active = true;
    const poll = async () => {
      try {
        const r = await api.get<any>("/api/whatsapp");
        if (active) setWa(r);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 1800);
    return () => { active = false; clearInterval(id); };
  }, [tab]);

  return (
    <main className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-10">
      <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-[560px]">
        <div className="panel neon relative overflow-hidden p-7 sm:p-9">
          <div className="mb-6 flex gap-2">
            <button className={`btn flex-1 ${tab === "telegram" ? "btn-primary" : ""}`} onClick={() => setTab("telegram")}>Telegram</button>
            <button className={`btn flex-1 ${tab === "whatsapp" ? "btn-primary" : ""}`} onClick={() => setTab("whatsapp")}>WhatsApp</button>
          </div>

          {tab === "telegram" ? (
            <>
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--line2)] bg-[var(--panel2)] text-[var(--text)] shadow-[0_0_28px_-6px_var(--glow)]"><IconTelegram size={30} /></div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-[27px]">Hubungkan Bot Telegram</h1>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--muted)]">Validasi dilakukan real-time langsung ke Telegram Bot API. Token disimpan terenkripsi.</p>
              <label className="mt-6 block font-mono2 text-[10.5px] uppercase tracking-[0.25em] text-[var(--faint)]">Telegram Bot Token</label>
              <div className="relative mt-2">
                <input className="input font-mono2 !pr-11" type={show ? "text" : "password"} placeholder="123456789:AA..." value={token} autoComplete="off" spellCheck={false} onChange={e => setToken(e.target.value)} onKeyDown={e => e.key === "Enter" && connectTelegram()} />
                <button type="button" onClick={() => setShow(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"><IconEye size={17} /></button>
              </div>
              <button className="btn btn-primary mt-5 w-full !py-3 !text-[14px]" onClick={connectTelegram} disabled={st.s === "loading"}>{st.s === "loading" ? "Memvalidasi..." : <><IconBolt size={16}/> Hubungkan Telegram</>}</button>
            </>
          ) : (
            <>
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--line2)] bg-[var(--panel2)] text-[var(--text)] shadow-[0_0_28px_-6px_var(--glow)]"><IconChat size={30} /></div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-[27px]">Hubungkan WhatsApp</h1>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--muted)]">Pairing memakai <b>Baileys 6.7.18</b>. QR yang tampil berasal dari payload pairing WhatsApp yang diterima server, bukan QR simulasi.</p>

              {!wa.connected && (
                <>
                  <div className="mt-5 grid grid-cols-2 gap-2">
                    <input className="input font-mono2" placeholder="628123456789" value={phone} onChange={e => setPhone(e.target.value)} />
                    <button className="btn btn-primary" onClick={() => waAction("pair", { phone })} disabled={st.s === "loading"}>Pairing Code</button>
                  </div>
                  <button className="btn mt-2 w-full" onClick={() => waAction("connect")} disabled={st.s === "loading"}>Generate QR WhatsApp</button>
                </>
              )}

              <div className="mt-5 flex min-h-[180px] items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--panel2)] p-4">
                {wa.connected ? (
                  <div className="text-center"><div className="text-4xl">✅</div><p className="mt-2 font-bold">WhatsApp terhubung</p><p className="font-mono2 text-xs text-[var(--muted)]">{wa.phone || wa.jid}</p></div>
                ) : wa.qrDataUrl ? (
                  <img src={wa.qrDataUrl} alt="QR WhatsApp dari Baileys" className="h-64 w-64 rounded-lg bg-white p-2" />
                ) : wa.pairingCode ? (
                  <div className="text-center"><p className="text-xs text-[var(--muted)]">Masukkan kode ini pada WhatsApp → Perangkat tertaut → Tautkan dengan nomor telepon</p><p className="mt-4 font-mono text-3xl font-bold tracking-[0.18em]">{wa.pairingCode}</p></div>
                ) : (
                  <p className="text-center text-sm text-[var(--muted)]">Klik Generate QR atau masukkan nomor internasional untuk Pairing Code.</p>
                )}
              </div>

              {wa.connected && <button className="btn mt-3 w-full" onClick={() => waAction("disconnect")}>Putuskan koneksi</button>}
              <p className="mt-3 text-center font-mono2 text-[10px] text-[var(--faint)]">Sesi tersimpan di data/whatsapp-auth agar tidak perlu scan ulang setelah restart pada server dengan disk persisten.</p>
            </>
          )}

          <AnimatePresence mode="wait">
            {st.s === "error" && <motion.p key="err" initial={{opacity:0,y:-6}} animate={{opacity:1,y:0}} className="mt-3 rounded-lg border border-[var(--bad)]/30 bg-[var(--bad)]/10 px-3 py-2 text-[13px] font-semibold text-[var(--bad)]">{st.msg}</motion.p>}
            {st.s === "ok" && tab === "telegram" && <motion.p key="ok" initial={{opacity:0,y:-6}} animate={{opacity:1,y:0}} className="mt-3 rounded-lg border border-[var(--ok)]/30 bg-[var(--ok)]/10 px-3 py-2 text-[13px] font-semibold text-[var(--ok)]">✅ Terhubung.</motion.p>}
          </AnimatePresence>

          <div className="mt-7 grid grid-cols-3 gap-2.5 border-t border-[var(--line)] pt-5">
            {[{icon:IconChat,t:"Live Chat",d:"Real-time"},{icon:IconBot,t:"Auto AI",d:"Gemini"},{icon:IconLock,t:"Aman",d:"Session auth"}].map(f => <div key={f.t} className="panel panel-hover p-3 text-center"><f.icon size={17} className="mx-auto text-[var(--muted)]"/><p className="mt-1.5 text-[12px] font-bold">{f.t}</p><p className="font-mono2 text-[9.5px] text-[var(--faint)]">{f.d}</p></div>)}
          </div>
        </div>
      </motion.div>
    </main>
  );
}
