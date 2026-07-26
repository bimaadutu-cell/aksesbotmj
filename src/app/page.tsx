"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Splash from "@/components/Splash";
import Shell, { type View } from "@/components/Shell";
import ConnectView from "@/components/ConnectView";
import DashboardView from "@/components/DashboardView";
import ChatView from "@/components/ChatView";
import UsersView from "@/components/UsersView";
import SettingsView from "@/components/SettingsView";
import AdminModal from "@/components/AdminModal";
import { api, ev, beep, type BootData } from "@/lib/client";

export default function Page() {
  const [splash, setSplash] = useState(true);
  const [boot, setBoot] = useState<BootData | null>(null);
  const [view, setViewState] = useState<View>("dashboard");
  const [theme, setThemeState] = useState("dark");
  const [adminOpen, setAdminOpen] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const doneSplash = useCallback(() => setSplash(false), []);

  const refreshBoot = useCallback(async () => {
    try { setBoot(await api.get<BootData>("/api/data?type=boot")); } catch { /* server sibuk */ }
  }, []);

  const setView = useCallback((v: View) => {
    setViewState(v);
    try { window.location.hash = v === "dashboard" ? "/" : `/${v}`; } catch { /* */ }
  }, []);

  const setTheme = useCallback((t: string) => {
    setThemeState(t);
    try {
      localStorage.setItem("abm_theme", t);
      document.documentElement.dataset.theme = t;
    } catch { /* */ }
  }, []);

  /* boot + hash routing + theme */
  useEffect(() => {
    let t = "dark";
    try {
      t = localStorage.getItem("abm_theme") ?? "dark";
      document.documentElement.dataset.theme = t;
    } catch { /* */ }
    setThemeState(t);

    refreshBoot().then(() => {
      const h = window.location.hash.replace(/^#\/?/, "") as View;
      if (["dashboard", "chat", "users", "settings"].includes(h)) setViewState(h);
    });

    const onHash = () => {
      const h = window.location.hash.replace(/^#\/?/, "") as View;
      if (["dashboard", "chat", "users", "settings"].includes(h)) setViewState(h);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [refreshBoot]);

  /* SSE realtime connection */
  useEffect(() => {
    if (!boot?.connected) return;
    const es = new EventSource("/api/stream");
    esRef.current = es;
    es.addEventListener("message", (e) => {
      try {
        const row = JSON.parse(e.data);
        let soundOn = true;
        try { soundOn = localStorage.getItem("abm_sound") !== "0"; } catch { /* */ }
        if (row?.direction === "in" && soundOn) beep();
        ev.emit("message", row);
        ev.emit("refresh-chats", null);
        ev.emit("stats", null);
      } catch { /* */ }
    });
    es.addEventListener("stats", () => ev.emit("stats", null));
    es.addEventListener("status", () => { refreshBoot(); ev.emit("stats", null); });
    es.addEventListener("log", (e) => { try { ev.emit("log", JSON.parse(e.data)); } catch { /* */ } });
    es.onerror = () => { /* EventSource akan auto-reconnect */ };
    const t = setInterval(refreshBoot, 45_000);
    return () => { es.close(); clearInterval(t); };
  }, [boot?.connected, refreshBoot]);

  if (splash) return <Splash onDone={doneSplash} />;

  // AdminModal HARUS selalu di posisi JSX yang sama agar tidak ke-remount
  // (remount = state login hilang = form login muncul lagi terus-terusan)
  return (
    <>
      {!boot?.connected ? (
        <div className="relative">
          <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-[var(--line)] bg-[var(--bg)]/75 px-5 backdrop-blur-xl">
            <span className="font-mono2 text-[15px] font-bold tracking-[0.22em]">AKSESBOTMU</span>
            <button className="btn btn-xs" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? "Light" : "Dark"} Mode
            </button>
          </header>
          <ConnectView onConnected={refreshBoot} />
          <SecretBrand onSecret={() => setAdminOpen(true)} />
          <footer className="fixed inset-x-0 bottom-0 border-t border-[var(--line)] bg-[var(--bg)]/70 py-3 text-center font-mono2 text-[10.5px] text-[var(--faint)] backdrop-blur">
            Aksesbotmu © 2026 · Developed by Bimz Official
          </footer>
        </div>
      ) : (
        <Shell view={view} setView={setView} boot={boot} theme={theme} setTheme={setTheme} onSecret={() => setAdminOpen(true)}>
          <div className="mx-auto w-full max-w-[1400px] p-4 sm:p-6">
            {view === "dashboard" && <DashboardView boot={boot} />}
            {view === "chat" && <ChatView boot={boot} />}
            {view === "users" && <UsersView boot={boot} />}
            {view === "settings" && <SettingsView boot={boot} onChanged={refreshBoot} />}
          </div>
        </Shell>
      )}
      <AdminModal open={adminOpen} onClose={() => setAdminOpen(false)} onChanged={refreshBoot} boot={boot} />
    </>
  );
}

/** small floating brand — 7 klik untuk membuka login admin (rahasia) */
function SecretBrand({ onSecret }: { onSecret: () => void }) {
  const clicks = useRef<number[]>([]);
  return (
    <button
      onClick={() => {
        const now = Date.now();
        clicks.current = [...clicks.current.filter((t) => now - t < 2600), now];
        if (clicks.current.length >= 7) { clicks.current = []; onSecret(); }
      }}
      className="fixed bottom-14 right-4 z-20 rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 font-mono2 text-[10px] tracking-[0.25em] text-[var(--faint)] backdrop-blur transition hover:text-[var(--text)]"
    >
      ABM·v3
    </button>
  );
}
