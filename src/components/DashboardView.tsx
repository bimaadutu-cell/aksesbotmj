"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { api, ev, fmtTime, timeAgo, type BootData, type MsgRow } from "@/lib/client";
import { IconUsers, IconChat, IconBolt, IconWifi, IconDoc, IconSend, IconBot } from "@/components/icons";

interface Stats {
  totalUsers: number; totalMessages: number; messagesToday: number; messagesIn: number; messagesOut: number;
  totalChats: number; errorCount: number; hourly: { h: number; n: number }[]; topUsers: { id: string; name: string; n: number }[];
  live: { startedAt: number | null; processed: number; lastBatch: number; latencyMs: number; apiOnline: boolean; lastPingAt: number; latencyHistory?: number[] };
}
interface LogRow { id: number; source: string | null; message: string | null; createdAt: string; }

/* ---------- realtime API latency sparkline ---------- */
function LatencyPanel({ history, current, online, lastPing }: { history: number[]; current: number; online: boolean; lastPing: number }) {
  const data = history.slice(-60);
  const max = Math.max(50, ...data);
  const min = data.length ? Math.min(...data) : 0;
  const avg = data.length ? Math.round(data.reduce((a, b) => a + b, 0) / data.length) : 0;
  const W = 600, H = 90;
  const pts = data.map((v, i) => `${(i / Math.max(1, data.length - 1)) * W},${H - (v / max) * (H - 8) - 4}`).join(" ");
  return (
    <div className="panel flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
      <div className="flex shrink-0 items-center gap-4">
        <div>
          <p className="font-mono2 text-[9.5px] uppercase tracking-[0.18em] text-[var(--faint)]">Ping API Saat Ini</p>
          <p className={`font-mono2 text-[30px] font-bold leading-none ${online ? "text-[var(--ok)]" : "text-[var(--bad)]"}`}>
            {lastPing ? `${current}ms` : "—"}
          </p>
        </div>
        <div className="hidden grid-cols-2 gap-x-5 gap-y-1 font-mono2 text-[10.5px] text-[var(--muted)] sm:grid">
          <span>MIN <b className="text-[var(--text)]">{data.length ? `${min}ms` : "-"}</b></span>
          <span>AVG <b className="text-[var(--text)]">{data.length ? `${avg}ms` : "-"}</b></span>
          <span>MAX <b className="text-[var(--text)]">{data.length ? `${Math.max(...data)}ms` : "-"}</b></span>
          <span>SAMPLE <b className="text-[var(--text)]">{data.length}/60</b></span>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        {data.length < 2 ? (
          <div className="flex h-[90px] items-center justify-center rounded-lg border border-dashed border-[var(--line)] font-mono2 text-[10.5px] text-[var(--faint)]">
            {online ? "Mengumpulkan sample ping (tiap 20 detik)..." : "Bot offline — ping tersedia setelah bot terhubung"}
          </div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="h-[90px] w-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="pingfill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--text)" stopOpacity="0.25" />
                <stop offset="100%" stopColor="var(--text)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <polygon points={`0,${H} ${pts} ${W},${H}`} fill="url(#pingfill)" />
            <polyline points={pts} fill="none" stroke="var(--text)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" style={{ filter: "drop-shadow(0 0 6px var(--glow))" }} />
            {data.length > 0 && (() => {
              const last = data[data.length - 1];
              return <circle cx={W} cy={H - (last / max) * (H - 8) - 4} r="4" fill="var(--text)" className="blink" />;
            })()}
          </svg>
        )}
        <div className="mt-1 flex justify-between font-mono2 text-[8.5px] text-[var(--faint)]">
          <span>−20 menit</span><span>skala max {max}ms</span><span>sekarang</span>
        </div>
      </div>
    </div>
  );
}

export default function DashboardView({ boot }: { boot: BootData }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [feed, setFeed] = useState<MsgRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const tz = boot.settings?.timezone;

  const load = async () => {
    try {
      const [s, f, l] = await Promise.all([
        api.get<Stats>("/api/data?type=stats"),
        api.get<{ messages: MsgRow[] }>("/api/data?type=messages&chatId=__none__").catch(() => ({ messages: [] })),
        api.get<{ logs: LogRow[] }>("/api/data?type=logs"),
      ]);
      setStats(s); setLogs(l.logs);
      void f;
    } catch { /* retry berikutnya */ }
  };
  const loadFeed = async () => {
    try {
      const chats = await api.get<{ chats: any[] }>("/api/data?type=chats");
      const top = chats.chats.slice(0, 6);
      const all: MsgRow[] = [];
      for (const c of top) {
        const m = await api.get<{ messages: MsgRow[] }>(`/api/data?type=messages&chatId=${encodeURIComponent(c.chat_id)}`);
        all.push(...m.messages.slice(-3));
      }
      all.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      setFeed(all.slice(0, 10));
    } catch { /* */ }
  };

  useEffect(() => { load(); loadFeed(); const t = setInterval(load, 12_000); return () => clearInterval(t); }, []);
  useEffect(() => ev.on("stats", () => load()), []);
  useEffect(() => ev.on("message", (row: MsgRow) => {
    setFeed((f) => [row, ...f].slice(0, 10));
    ev.emit("refresh-logs", null);
  }), []);
  useEffect(() => ev.on("log", () => { api.get<{ logs: LogRow[] }>("/api/data?type=logs").then((l) => setLogs(l.logs)).catch(() => {}); }), []);

  const live = stats?.live ?? boot.live;
  const online = !!boot.connected && live?.apiOnline !== false;
  const uptime = live?.startedAt ? Math.floor((Date.now() - live.startedAt) / 1000) : 0;
  const upStr = `${Math.floor(uptime / 3600)}j ${Math.floor((uptime % 3600) / 60)}m`;
  const maxH = Math.max(1, ...(stats?.hourly ?? []).map((x) => Number(x.n)));

  const cards = [
    { label: "Total User", value: stats?.totalUsers ?? "—", icon: IconUsers },
    { label: "Total Chat", value: stats?.totalChats ?? "—", icon: IconChat },
    { label: "Pesan Hari Ini", value: stats?.messagesToday ?? "—", icon: IconBolt },
    { label: "Pesan Masuk", value: stats?.messagesIn ?? "—", icon: IconDoc },
    { label: "Pesan Keluar", value: stats?.messagesOut ?? "—", icon: IconSend },
    { label: "Bot Online", value: online ? "YA" : "TIDAK", icon: IconBot, tone: online ? "ok" : "bad" },
    { label: "Telegram API", value: live?.apiOnline ? "OPERASIONAL" : "OFFLINE", icon: IconWifi, tone: live?.apiOnline ? "ok" : "bad" },
    { label: "Ping API", value: live?.lastPingAt ? `${live.latencyMs}ms` : "—", icon: IconBolt },
    { label: "Queue Update", value: `${live?.lastBatch ?? 0} / ${live?.processed ?? 0}`, icon: IconDoc },
    { label: "Error Log", value: stats?.errorCount ?? 0, icon: IconDoc, tone: (stats?.errorCount ?? 0) > 0 ? "bad" : undefined },
  ];

  return (
    <div className="space-y-5">
      {/* status strip */}
      <div className="panel flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3.5 font-mono2 text-[11px] text-[var(--muted)]">
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${online ? "pulse-dot bg-[var(--ok)] text-[var(--ok)]" : "bg-[var(--bad)]"}`} />
          <b className="text-[var(--text)]">{online ? "ENGINE AKTIF" : "ENGINE OFF"}</b>
        </span>
        <span>MODE: <b className="text-[var(--text)]">{(boot.bot?.mode ?? "polling").toUpperCase()}</b></span>
        <span>UPTIME: <b className="text-[var(--text)]">{upStr}</b></span>
        <span>SINKRON: <b className="text-[var(--text)]">{timeAgo(boot.bot?.lastSyncAt)}</b></span>
        <span className="ml-auto hidden sm:inline">UPDATE DIPROSES: <b className="text-[var(--text)]">{live?.processed ?? 0}</b></span>
      </div>

      {/* stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {cards.map((c, i) => (
          <motion.div key={c.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03, duration: 0.35 }} className="panel panel-hover p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono2 text-[9.5px] uppercase tracking-[0.18em] text-[var(--faint)]">{c.label}</span>
              <c.icon size={15} className={c.tone === "ok" ? "text-[var(--ok)]" : c.tone === "bad" ? "text-[var(--bad)]" : "text-[var(--muted)]"} />
            </div>
            <p className={`mt-2 font-mono2 text-[22px] font-bold leading-none ${c.tone === "ok" ? "text-[var(--ok)]" : c.tone === "bad" ? "text-[var(--bad)]" : ""}`}>{c.value}</p>
          </motion.div>
        ))}
      </div>

      {/* ---------- API latency monitor ---------- */}
      <LatencyPanel history={live?.latencyHistory ?? []} current={live?.latencyMs ?? 0} online={live?.apiOnline !== false && !!boot.connected} lastPing={live?.lastPingAt ?? 0} />

      <div className="grid gap-4 xl:grid-cols-5">
        {/* hourly chart */}
        <div className="panel p-5 xl:col-span-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[13.5px] font-bold">Aktivitas 24 Jam</h3>
            <span className="chip font-mono2 !text-[10px]">realtime · {tz}</span>
          </div>
          <div className="mt-4 flex h-36 items-end gap-[3px]">
            {Array.from({ length: 24 }).map((_, h) => {
              const n = Number((stats?.hourly ?? []).find((x) => Number(x.h) === h)?.n ?? 0);
              return (
                <div key={h} className="group relative flex-1">
                  <div
                    className="w-full rounded-t-[3px] bg-[var(--text)]/80 transition-all duration-500 group-hover:bg-[var(--text)]"
                    style={{ height: `${Math.max(3, (n / maxH) * 132)}px`, opacity: n ? 0.9 : 0.15, boxShadow: n ? "0 0 12px -4px var(--glow)" : undefined }}
                  />
                  <span className="pointer-events-none absolute -top-7 left-1/2 z-10 -translate-x-1/2 rounded border border-[var(--line)] bg-[var(--bg2)] px-1.5 py-0.5 font-mono2 text-[9px] opacity-0 transition group-hover:opacity-100">
                    {String(h).padStart(2, "0")}:00 · {n}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between font-mono2 text-[9px] text-[var(--faint)]"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div>
        </div>

        {/* top users */}
        <div className="panel p-5 xl:col-span-2">
          <h3 className="text-[13.5px] font-bold">User Teraktif (24 jam)</h3>
          <div className="mt-3 space-y-2">
            {(stats?.topUsers ?? []).length === 0 && <p className="py-6 text-center font-mono2 text-[11px] text-[var(--faint)]">Belum ada aktivitas.</p>}
            {(stats?.topUsers ?? []).map((u, i) => (
              <div key={u.id} className="flex items-center gap-3 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2">
                <span className="font-mono2 text-[11px] font-bold text-[var(--muted)]">#{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{u.name ?? u.id}</span>
                <span className="font-mono2 text-[11px] text-[var(--muted)]">{u.n} pesan</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* live feed */}
        <div className="panel p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-[13.5px] font-bold">Feed Pesan Live</h3>
            <span className="chip !text-[var(--ok)]"><span className="h-1.5 w-1.5 rounded-full bg-current pulse-dot" />LIVE</span>
          </div>
          <div className="mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {feed.length === 0 && <p className="py-8 text-center font-mono2 text-[11px] text-[var(--faint)]">Menunggu pesan masuk...</p>}
            {feed.map((m) => (
              <div key={m.id} className="fade-up flex items-center gap-2.5 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2">
                <span className={`font-mono2 text-[9px] font-bold ${m.direction === "in" ? "text-[var(--ok)]" : "text-[var(--muted)]"}`}>{m.direction === "in" ? "MASUK" : "KELUAR"}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--muted)]">{m.text || m.caption || `[${m.kind}]`}</span>
                <span className="font-mono2 text-[9.5px] text-[var(--faint)]">{fmtTime(m.createdAt, tz)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* error log */}
        <div className="panel p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-[13.5px] font-bold">Error Log</h3>
            <span className="chip font-mono2 !text-[10px]">{stats?.errorCount ?? 0} total</span>
          </div>
          <div className="mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {logs.length === 0 && <p className="py-8 text-center font-mono2 text-[11px] text-[var(--ok)]">✓ Tidak ada error. Sistem sehat.</p>}
            {logs.map((l) => (
              <div key={l.id} className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono2 text-[9.5px] font-bold uppercase text-[var(--bad)]">{l.source}</span>
                  <span className="font-mono2 text-[9.5px] text-[var(--faint)]">{timeAgo(l.createdAt)}</span>
                </div>
                <p className="mt-0.5 truncate text-[12px] text-[var(--muted)]">{l.message}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
