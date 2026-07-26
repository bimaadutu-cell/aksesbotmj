"use client";
import { useRef, useState, type ReactNode } from "react";
import { api, fmtDate, timeAgo, type BootData } from "@/lib/client";
import { IconBolt, IconDownload, IconUpload, IconRefresh, IconLogout, IconWifi } from "@/components/icons";

const TZS = ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura", "Asia/Singapore", "UTC"];

/* Row di level modul — input di dalamnya tidak kehilangan fokus/keyboard saat mengetik */
function Row({ label, desc, children }: { label: string; desc?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-[var(--line)] py-3.5 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-[13px] font-bold">{label}</p>
        {desc && <p className="mt-0.5 max-w-[420px] font-mono2 text-[10.5px] leading-relaxed text-[var(--faint)]">{desc}</p>}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export default function SettingsView({ boot, onChanged }: { boot: BootData; onChanged: () => Promise<void> | void }) {
  const [url, setUrl] = useState(boot.bot?.webhookUrl ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const bot = boot.bot;

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setMsg(null);
    try { await fn(); } catch (e: any) { setMsg(`❌ ${e?.message ?? "Gagal"}`); }
    setBusy(null);
    onChanged();
  };

  const setMode = (mode: "polling" | "webhook") =>
    act(`mode-${mode}`, async () => {
      const r = await api.post<{ message?: string }>("/api/bot", { action: "mode", mode, url });
      setMsg(`✅ ${r.message ?? "Mode diganti"}`);
    });

  const exportJson = async () => {
    const r = await fetch("/api/data?type=backup");
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `aksesbotmu-backup-${Date.now()}.json`;
    a.click(); URL.revokeObjectURL(a.href);
    setMsg("✅ Backup JSON diunduh.");
  };
  const importJson = async (f: File) => {
    await act("import", async () => {
      const payload = JSON.parse(await f.text());
      const r = await api.post<{ users?: number; msgs?: number }>("/api/actions", { action: "restore", payload });
      setMsg(`✅ Restore selesai: ${r.users ?? 0} user, ${r.msgs ?? 0} pesan.`);
    });
  };
  const logout = async () => {
    if (!confirm("Putuskan koneksi bot? Riwayat chat tetap tersimpan di database.")) return;
    await act("logout", async () => {
      await api.post("/api/bot", { action: "disconnect" });
      setMsg("✅ Bot terputus.");
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {msg && <div className="panel fade-up px-4 py-2.5 text-[12.5px] font-semibold">{msg}</div>}

      <section className="panel p-5">
        <h3 className="flex items-center gap-2 text-[14px] font-bold"><IconWifi size={16} /> Koneksi Bot</h3>
        <Row label="Token Bot" desc="Disimpan terenkripsi AES-256-GCM di server — tidak pernah ditampilkan penuh.">
          <span className="chip font-mono2 !text-[11px]">{bot?.tokenMasked ?? "—"}</span>
        </Row>
        <Row label="Mode Sinkronisasi" desc={`Aktif saat ini: ${bot?.mode === "webhook" ? "Webhook" : "Long Polling"} · Sinkron terakhir ${timeAgo(bot?.lastSyncAt)}`}>
          <span className={`chip !text-[10.5px] ${bot?.mode === "webhook" ? "" : "!border-[var(--text)] !bg-[var(--text)] !text-[var(--bg)]"}`}>Long Polling</span>
          <span className={`chip !text-[10.5px] ${bot?.mode === "webhook" ? "!border-[var(--text)] !bg-[var(--text)] !text-[var(--bg)]" : ""}`}>Webhook</span>
        </Row>
        <Row label="Ganti Webhook" desc="URL publik https yang menerima update Telegram (mis. https://domainmu.com/api/webhook).">
          <input className="input !w-56 !py-1.5 font-mono2 !text-[11px]" placeholder="https://.../api/webhook" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn btn-xs" disabled={busy !== null} onClick={() => setMode("webhook")}>{busy === "mode-webhook" ? "..." : "Pasang"}</button>
        </Row>
        <Row label="Aktifkan Long Polling" desc="Server menarik update langsung dari Telegram — cocok untuk VPS/server always-on. Bot online 24/7 selama proses server hidup.">
          <button className="btn btn-xs" disabled={busy !== null} onClick={() => setMode("polling")}>{busy === "mode-polling" ? "..." : "Aktifkan Polling"}</button>
        </Row>
        <Row label="Deploy ke Vercel?" desc="Vercel bersifat serverless (tidak bisa long-polling). Setelah deploy: pasang mode Webhook dengan URL https://DOMAIN-KAMU.vercel.app/api/webhook — Telegram akan mendorong update ke sana dan semua fitur (balas, AI, command) tetap jalan. Pastikan DATABASE_URL mengarah ke database cloud (mis. Neon) dan semua API key diisi ulang di Panel Admin.">
          <span className="chip !text-[10px]">Info</span>
        </Row>
        <Row label="Terhubung sejak" desc={`Bot ID ${bot?.id ?? "-"} · @${bot?.username ?? "-"}`}>
          <span className="chip font-mono2 !text-[10.5px]">{fmtDate(bot?.connectedAt, boot.settings?.timezone)}</span>
        </Row>
      </section>

      <section className="panel p-5">
        <h3 className="flex items-center gap-2 text-[14px] font-bold"><IconRefresh size={16} /> Data & Backup</h3>
        <Row label="Backup Data (Export JSON)" desc="Seluruh konfigurasi, user, dan riwayat chat dalam satu file JSON.">
          <button className="btn btn-xs" onClick={exportJson}><IconDownload size={13} /> Export JSON</button>
        </Row>
        <Row label="Restore Data (Import JSON)" desc="Pulihkan dari file backup. Butuh login admin (klik teks AKSESBOTMU 7×).">
          <button className="btn btn-xs" onClick={() => importRef.current?.click()}><IconUpload size={13} /> Import JSON</button>
          <input ref={importRef} type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = ""; }} />
        </Row>
      </section>

      <section className="panel p-5">
        <h3 className="text-[14px] font-bold">Preferensi Dashboard</h3>
        <Row label="Timezone" desc="Dipakai bot dan tampilan waktu dashboard.">
          <select
            className="input !w-48 !py-1.5 !text-[12px]"
            value={boot.settings?.timezone ?? "Asia/Jakarta"}
            onChange={(e) => api.post("/api/actions", { action: "configSave", patch: { timezone: e.target.value } }).then(() => onChanged()).catch(() => setMsg("❌ Butuh login admin untuk menyimpan."))}
          >
            {TZS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Row>
        <Row label="Bahasa Bot" desc="Bahasa default respon bot.">
          <select
            className="input !w-48 !py-1.5 !text-[12px]"
            value={boot.settings?.language ?? "id"}
            onChange={(e) => api.post("/api/actions", { action: "configSave", patch: { language: e.target.value } }).then(() => onChanged()).catch(() => setMsg("❌ Butuh login admin untuk menyimpan."))}
          >
            <option value="id">Indonesia</option>
            <option value="en">English</option>
          </select>
        </Row>
        <Row label="Notifikasi Suara" desc="Bunyi saat ada pesan masuk baru di dashboard.">
          <button className="btn btn-xs" onClick={() => {
            const v = localStorage.getItem("abm_sound") !== "0" ? "0" : "1";
            localStorage.setItem("abm_sound", v);
            setMsg(v === "1" ? "🔔 Suara notifikasi aktif." : "🔕 Suara notifikasi mati.");
          }}>
            {typeof window !== "undefined" && localStorage.getItem("abm_sound") !== "0" ? "🔔 Aktif" : "🔕 Mati"}
          </button>
        </Row>
      </section>

      <section className="panel p-5">
        <h3 className="flex items-center gap-2 text-[14px] font-bold"><IconBolt size={16} /> Sesi</h3>
        <Row label="Putuskan Bot (Logout)" desc="Menghentikan engine & menghapus webhook. Token terenkripsi dihapus dari konfigurasi aktif.">
          <button className="btn btn-xs btn-danger" disabled={busy !== null} onClick={logout}><IconLogout size={13} /> Logout</button>
        </Row>
      </section>

      <p className="pb-4 text-center font-mono2 text-[10px] text-[var(--faint)]">
        Aksesbotmu © 2026 · Developed by Bimz Official · Engine v3.0
      </p>
    </div>
  );
}
