"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/client";
import { IconTelegram, IconEye, IconBolt, IconChat, IconBot, IconLock } from "@/components/icons";

type State = { s: "idle" } | { s: "loading" } | { s: "error"; msg: string } | { s: "ok"; bot: any };

export default function ConnectView({ onConnected }: { onConnected: () => Promise<void> | void }) {
  const [token, setToken] = useState("");
  const [show, setShow] = useState(false);
  const [st, setSt] = useState<State>({ s: "idle" });

  const connect = async () => {
    if (!token.trim()) { setSt({ s: "error", msg: "❌ Masukkan Bot Token terlebih dahulu." }); return; }
    setSt({ s: "loading" });
    try {
      const r = await api.post<{ ok: boolean; bot: any }>("/api/bot", { action: "connect", token: token.trim() });
      setSt({ s: "ok", bot: r.bot });
      setTimeout(() => onConnected(), 1200);
    } catch (e: any) {
      setSt({ s: "error", msg: e?.message ?? "❌ Token Bot tidak valid." });
    }
  };

  return (
    <main className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-10">
      <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }} className="w-full max-w-[560px]">
        <div className="panel neon relative overflow-hidden p-7 sm:p-9">
          <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full border border-[var(--line)] opacity-60" />
          <div className="pointer-events-none absolute -right-8 -top-8 h-48 w-48 rounded-full border border-[var(--line)] opacity-40" />

          <motion.div
            initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.1, duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
            className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--line2)] bg-[var(--panel2)] text-[var(--text)] shadow-[0_0_28px_-6px_var(--glow)]"
          >
            <IconTelegram size={30} />
          </motion.div>

          <h1 className="text-2xl font-bold tracking-tight sm:text-[27px]">Hubungkan Bot Telegram</h1>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--muted)]">
            Tempel Bot Token dari <span className="font-mono2 text-[var(--text)]">@BotFather</span> — validasi dilakukan real-time langsung ke Telegram Bot API. Token disimpan terenkripsi (AES-256-GCM).
          </p>

          <label className="mt-6 block font-mono2 text-[10.5px] uppercase tracking-[0.25em] text-[var(--faint)]">Telegram Bot Token</label>
          <div className="relative mt-2">
            <input
              className="input font-mono2 !pr-11"
              type={show ? "text" : "password"}
              placeholder="Masukkan Bot Token Telegram..."
              value={token}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && connect()}
            />
            <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] transition hover:text-[var(--text)]" title="Tampilkan token">
              <IconEye size={17} />
            </button>
          </div>

          <AnimatePresence mode="wait">
            {st.s === "error" && (
              <motion.p key="err" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-3 rounded-lg border border-[var(--bad)]/30 bg-[var(--bad)]/10 px-3 py-2 text-[13px] font-semibold text-[var(--bad)]">
                {st.msg}
              </motion.p>
            )}
            {st.s === "ok" && (
              <motion.p key="ok" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-3 rounded-lg border border-[var(--ok)]/30 bg-[var(--ok)]/10 px-3 py-2 text-[13px] font-semibold text-[var(--ok)]">
                ✅ Bot berhasil terhubung — @{st.bot?.username} · membuka dashboard...
              </motion.p>
            )}
          </AnimatePresence>

          <button className="btn btn-primary mt-5 w-full !py-3 !text-[14px]" onClick={connect} disabled={st.s === "loading"}>
            {st.s === "loading" ? (
              <><span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--bg)]/30 border-t-[var(--bg)]" /> Memvalidasi token...</>
            ) : (
              <><IconBolt size={16} /> Hubungkan Bot</>
            )}
          </button>

          <div className="mt-7 grid grid-cols-3 gap-2.5 border-t border-[var(--line)] pt-5">
            {[
              { icon: IconChat, t: "Live Chat", d: "Balas real-time" },
              { icon: IconBot, t: "Auto AI", d: "Gemini 2.5 Flash" },
              { icon: IconLock, t: "Aman", d: "Token terenkripsi" },
            ].map((f) => (
              <div key={f.t} className="panel panel-hover p-3 text-center">
                <f.icon size={17} className="mx-auto text-[var(--muted)]" />
                <p className="mt-1.5 text-[12px] font-bold">{f.t}</p>
                <p className="font-mono2 text-[9.5px] text-[var(--faint)]">{f.d}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-4 text-center font-mono2 text-[10.5px] text-[var(--faint)]">
          Belum punya token? Buka Telegram → cari <span className="text-[var(--muted)]">@BotFather</span> → /newbot
        </p>
      </motion.div>
    </main>
  );
}
