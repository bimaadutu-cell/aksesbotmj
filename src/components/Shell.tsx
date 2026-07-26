"use client";
import React, { useRef } from "react";
import { motion } from "framer-motion";
import { IconDash, IconChat, IconUsers, IconGear, IconTelegram, IconMoon, IconSun, IconBolt, IconWifi } from "@/components/icons";
import type { BootData } from "@/lib/client";

export type View = "dashboard" | "chat" | "users" | "settings";

const NAV: { id: View; label: string; icon: (p: any) => React.ReactElement }[] = [
  { id: "dashboard", label: "Dashboard", icon: IconDash },
  { id: "chat", label: "Live Chat", icon: IconChat },
  { id: "users", label: "Pengguna", icon: IconUsers },
  { id: "settings", label: "Pengaturan", icon: IconGear },
];

export default function Shell({ view, setView, boot, theme, setTheme, onSecret, children }: {
  view: View;
  setView: (v: View) => void;
  boot: BootData | null;
  theme: string;
  setTheme: (t: string) => void;
  onSecret: () => void;
  children: React.ReactNode;
}) {
  const clicks = useRef<number[]>([]);
  const bot = boot?.bot;
  const online = !!(boot?.connected && boot?.live?.apiOnline !== false);

  const secretClick = () => {
    const now = Date.now();
    clicks.current = [...clicks.current.filter((t) => now - t < 2600), now];
    if (clicks.current.length >= 7) { clicks.current = []; onSecret(); }
  };

  const Brand = (
    <button onClick={secretClick} className="group flex select-none items-center gap-2.5 outline-none" title="AKSESBOTMU">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--line2)] bg-[var(--panel)] text-[var(--text)] transition group-hover:shadow-[0_0_18px_-4px_var(--glow)]">
        <IconTelegram size={19} />
      </span>
      <span className="font-mono2 text-[15px] font-bold tracking-[0.22em]">AKSESBOTMU</span>
    </button>
  );

  return (
    <div className="flex min-h-screen">
      {/* ---------- sidebar (desktop) ---------- */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-[var(--line)] bg-[var(--bg2)]/70 backdrop-blur-xl lg:flex">
        <div className="flex h-16 items-center border-b border-[var(--line)] px-5">{Brand}</div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setView(n.id)}
              className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-[13.5px] font-semibold transition ${
                view === n.id
                  ? "border-[var(--line2)] bg-[var(--text)] text-[var(--bg)] shadow-[0_0_22px_-8px_var(--glow)]"
                  : "border-transparent text-[var(--muted)] hover:bg-[var(--panel)] hover:text-[var(--text)]"
              }`}
            >
              <n.icon size={17} /> {n.label}
            </button>
          ))}

          <div className="panel mt-4 p-3.5">
            <div className="flex items-center gap-2.5">
              {bot?.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={bot.photoUrl} alt="bot" className="h-9 w-9 rounded-full border border-[var(--line2)] object-cover" />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line2)] bg-[var(--panel2)]"><IconTelegram size={16} /></span>
              )}
              <div className="min-w-0">
                <p className="truncate text-[13px] font-bold">{bot?.name ?? "Bot"}</p>
                <p className="truncate font-mono2 text-[10.5px] text-[var(--muted)]">@{bot?.username ?? "-"}</p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="chip !py-1">
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${online ? "pulse-dot bg-[var(--ok)] text-[var(--ok)]" : "bg-[var(--bad)]"}`} />
                {online ? "Online" : "Offline"}
              </span>
              <span className="chip !py-1 font-mono2">{boot?.live?.latencyMs ?? "—"}ms</span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 font-mono2 text-[10px] uppercase tracking-widest text-[var(--faint)]">
              <IconWifi size={12} /> {boot?.bot?.mode === "webhook" ? "Webhook" : "Long Polling"}
            </div>
          </div>
        </nav>

        <div className="border-t border-[var(--line)] p-4">
          <p className="font-mono2 text-[10.5px] leading-relaxed text-[var(--faint)]">
            Aksesbotmu © 2026<br />Developed by <span className="text-[var(--muted)]">Bimz Official</span>
          </p>
        </div>
      </aside>

      {/* ---------- main column ---------- */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--bg)]/75 px-4 backdrop-blur-xl sm:px-6">
          <div className="lg:hidden">{Brand}</div>
          <div className="hidden items-center gap-2 lg:flex">
            <motion.span key={view} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="text-[15px] font-bold capitalize">
              {NAV.find((n) => n.id === view)?.label}
            </motion.span>
          </div>
          <div className="flex items-center gap-2">
            <span className="chip font-mono2 !text-[10.5px]">
              <IconBolt size={12} /> {boot?.live?.latencyMs ?? "—"}ms
            </span>
            <span className={`chip !text-[10.5px] ${online ? "!text-[var(--ok)]" : "!text-[var(--bad)]"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${online ? "pulse-dot bg-current" : "bg-current"}`} />
              {online ? "BOT ONLINE" : "OFFLINE"}
            </span>
            <button className="btn btn-xs" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="Ganti tema">
              {theme === "dark" ? <IconSun size={14} /> : <IconMoon size={14} />}
            </button>
          </div>
        </header>

        <main className="min-w-0 flex-1 pb-24 lg:pb-8">{children}</main>

        {/* ---------- bottom nav (mobile) ---------- */}
        <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-[var(--line)] bg-[var(--bg2)]/85 backdrop-blur-xl lg:hidden">
          {NAV.map((n) => (
            <button key={n.id} onClick={() => setView(n.id)} className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-semibold ${view === n.id ? "text-[var(--text)]" : "text-[var(--faint)]"}`}>
              <n.icon size={19} /> {n.label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
