"use client";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api, setAdminToken, type BootData, type QuickReply } from "@/lib/client";
import { IconLock, IconX, IconLogout, IconDownload, IconUpload, IconEye } from "@/components/icons";

/* Field di level modul (stateful) — input stabil, keyboard mobile tidak tertutup saat mengetik */
function Field({ label, value, set, placeholder, mono, type, hint, autoOff, eye }: {
  label: string; value: string; set: (v: string) => void; placeholder?: string;
  mono?: boolean; type?: string; hint?: string; autoOff?: boolean; eye?: boolean;
}) {
  const [show, setShow] = useState(false);
  const isPass = type === "password";
  return (
    <label className="block min-w-0">
      <span className="font-mono2 text-[9.5px] uppercase tracking-[0.2em] text-[var(--faint)]">{label}</span>
      <span className="relative mt-1 block">
        <input
          type={isPass && show ? "text" : type ?? "text"}
          className={`input !py-2 !text-[13px] ${mono ? "font-mono2 !text-[12px]" : ""} ${eye ? "!pr-10" : ""}`}
          value={value} placeholder={placeholder}
          onChange={(e) => set(e.target.value)}
          {...(autoOff ? { autoComplete: "off", autoCapitalize: "none", autoCorrect: "off", spellCheck: false } : {})}
        />
        {eye && isPass && (
          <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)] transition hover:text-[var(--text)]" title={show ? "Sembunyikan" : "Lihat"}>
            <IconEye size={15} />
          </button>
        )}
      </span>
      {hint && <span className="mt-0.5 block font-mono2 text-[9px] leading-relaxed text-[var(--faint)]">{hint}</span>}
    </label>
  );
}

const GEMINI_MODELS = [
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite ⚡ (default, tercepat)" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
];

export default function AdminModal({ open, onClose, onChanged, boot }: {
  open: boolean; onClose: () => void; onChanged: () => Promise<void> | void; boot: BootData | null;
}) {
  const [authed, setAuthed] = useState(false);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCreds, setShowCreds] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [devName, setDevName] = useState("");
  const [devPhone, setDevPhone] = useState("");
  const [devTele, setDevTele] = useState("");
  const [startMenu, setStartMenu] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [autoAI, setAutoAI] = useState(false);
  const [maintenance, setMaintenance] = useState(false);
  const [qrs, setQrs] = useState<QuickReply[]>([]);
  const [geminiKey, setGeminiKey] = useState("");
  const [geminiModel, setGeminiModel] = useState("gemini-2.5-flash-lite");
  const [tmdbKey, setTmdbKey] = useState("");
  const [reportTarget, setReportTarget] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  // boot boleh berubah-ubah (refresh realtime) TANPA memicu ulang effect login —
  // inilah yang dulu bikin form login muncul lagi terus-terusan
  const bootRef = useRef(boot);
  bootRef.current = boot;

  const fillFrom = (s: any, extra?: { geminiKey?: string; geminiModel?: string; tmdbKey?: string; reportTarget?: string }) => {
    setDisplayName(s.displayName ?? "AKSESBOTMU");
    setDevName(s.devName ?? "Bimz Official");
    setDevPhone(s.devPhone ?? "");
    setDevTele(s.devTele ?? "");
    setStartMenu(s.startMenu ?? "");
    setAudioUrl(s.startAudioUrl ?? "");
    setAutoAI(!!s.autoAI);
    setMaintenance(!!s.maintenance);
    setQrs(s.quickReplies ?? []);
    if (extra?.geminiKey !== undefined) setGeminiKey(extra.geminiKey);
    if (extra?.geminiModel) setGeminiModel(extra.geminiModel);
    else setGeminiModel(s.geminiModel ?? "gemini-2.5-flash-lite");
    if (extra?.tmdbKey !== undefined) setTmdbKey(extra.tmdbKey);
    if (extra?.reportTarget !== undefined) setReportTarget(extra.reportTarget);
    else setReportTarget(s.reportTarget ?? "");
  };

  useEffect(() => {
    if (!open) return;
    setErr(null); setSaved(null);
    let alive = true;
    api.post<{ admin: boolean; geminiKey?: string; geminiModel?: string; tmdbKey?: string; reportTarget?: string }>("/api/actions", { action: "adminCheck" })
      .then((r) => {
        if (!alive) return;
        if (r.admin) {
          setAuthed(true);
          fillFrom(bootRef.current?.settings ?? {}, r);
        } else {
          setAuthed(false); // hanya balik ke form kalau server BENAR-BENAR bilang belum login
        }
      })
      .catch(() => {
        // error jaringan = biarkan state sekarang (jangan flip-flop ke form login)
      });
    return () => { alive = false; };
  }, [open]);

  const login = async () => {
    const u = user.trim();
    if (!u || !pass) { setErr("❗ Username dan password wajib diisi."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ ok: boolean; token?: string }>("/api/actions", { action: "adminLogin", user: u, pass });
      if (r.token) setAdminToken(r.token); // sesi cadangan bila cookie diblokir proxy
      setAuthed(true);
      const [b, chk] = await Promise.all([
        api.get<BootData>("/api/data?type=boot"),
        api.post<{ geminiKey?: string; geminiModel?: string; tmdbKey?: string; reportTarget?: string }>("/api/actions", { action: "adminCheck" }),
      ]);
      fillFrom(b.settings ?? {}, chk);
      onChanged();
    } catch (e: any) {
      setErr(e?.message ?? "Login gagal — periksa kembali kredensial.");
    }
    setBusy(false);
  };

  const handleSaveError = (e: any) => {
    const msg = String(e?.message ?? "Gagal menyimpan");
    if (/login admin|401/i.test(msg)) {
      // sesi habis — balik ke form login dengan pesan jelas, bukan error menggantung
      setAdminToken(null);
      setAuthed(false);
      setErr("🔒 Sesi admin berakhir. Login lagi, lalu ulangi simpan.");
    } else {
      setSaved(`❌ ${msg}`);
    }
  };

  const save = async () => {
    setBusy(true); setSaved(null);
    try {
      await api.post("/api/actions", {
        action: "configSave",
        patch: {
          displayName, devName, devPhone, devTele, startMenu,
          startAudioUrl: audioUrl, autoAI, maintenance,
          geminiModel, geminiKey, tmdbKey, reportTarget: reportTarget.trim(),
          quickReplies: qrs.filter((q) => q.trigger.trim() && q.response.trim()),
        },
      });
      setSaved("✅ Konfigurasi tersimpan & langsung aktif di bot (real-time).");
      onChanged();
    } catch (e) { handleSaveError(e); }
    setBusy(false);
  };

  const saveAi = async () => {
    setBusy(true); setSaved(null);
    try {
      await api.post("/api/actions", { action: "configSave", patch: { geminiModel, geminiKey } });
      setSaved(geminiKey.trim() ? "✅ Gemini key tersimpan (terenkripsi). Tes dari Telegram: /ai halo" : "ℹ️ Gemini key dikosongkan — AI pakai mode fallback.");
      onChanged();
    } catch (e) { handleSaveError(e); }
    setBusy(false);
  };
  const saveTmdb = async () => {
    setBusy(true); setSaved(null);
    try {
      await api.post("/api/actions", { action: "configSave", patch: { tmdbKey } });
      setSaved(tmdbKey.trim() ? "✅ TMDB key tersimpan. Tes dari Telegram: /film avatar" : "ℹ️ TMDB key dikosongkan — /film pakai key server (jika ada).");
      onChanged();
    } catch (e) { handleSaveError(e); }
    setBusy(false);
  };

  const exportCfg = () => {
    const s = { ...(bootRef.current?.settings ?? {}) } as any;
    delete s.geminiKeyEnc; delete s.tmdbKeyEnc;
    const blob = new Blob([JSON.stringify(s, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `aksesbotmu-config-${Date.now()}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  };
  const importCfg = async (f: File) => {
    try {
      const patch = JSON.parse(await f.text());
      delete patch.geminiKeyEnc; delete patch.tmdbKeyEnc;
      await api.post("/api/actions", { action: "configSave", patch });
      setSaved("✅ Konfigurasi diimpor.");
      onChanged();
    } catch { setSaved("❌ File konfigurasi tidak valid."); }
  };
  const logout = async () => {
    await api.post("/api/actions", { action: "adminLogout" }).catch(() => {});
    setAdminToken(null);
    setAuthed(false); setUser(""); setPass("");
    onChanged();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
          <motion.div initial={{ scale: 0.93, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }} transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
            className="panel neon max-h-[88vh] w-full max-w-lg overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-[15px] font-bold"><IconLock size={16} /> {authed ? "Panel Admin — Konfigurasi Bot" : "Login Admin"}</h3>
              <button onClick={onClose} className="text-[var(--muted)] transition hover:text-[var(--text)]"><IconX size={17} /></button>
            </div>

            {!authed ? (
              <div className="space-y-3.5">
                <p className="font-mono2 text-[11px] leading-relaxed text-[var(--muted)]">Area tersembunyi untuk owner. Kelola nama bot, menu /start, audio, Auto AI, API key Gemini & TMDB, tujuan laporan, dan lainnya.</p>
                <Field label="Username" value={user} set={setUser} placeholder="username admin" mono autoOff />
                <Field label="Password" value={pass} set={setPass} placeholder="password admin" mono autoOff type="password" eye />
                {err && <p className="rounded-lg border border-[var(--bad)]/30 bg-[var(--bad)]/10 px-3 py-2 text-[12.5px] font-semibold text-[var(--bad)]">{err}</p>}
                <button className="btn btn-primary w-full !py-2.5" onClick={login} disabled={busy || !user || !pass}>
                  {busy ? "Memverifikasi..." : "Masuk Panel Admin"}
                </button>

                <button className="mx-auto block font-mono2 text-[10px] text-[var(--faint)] underline decoration-dotted transition hover:text-[var(--text)]" onClick={() => setShowCreds((v) => !v)}>
                  {showCreds ? "− Sembunyikan kredensial default" : "+ Lupa kredensial? (kredensial default)"}
                </button>
                <AnimatePresence>
                  {showCreds && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2.5 font-mono2 text-[11px] leading-relaxed">
                        <p>Username: <b className="select-all">admin0987</b></p>
                        <p>Password: <b className="select-all">admin?0987#$@</b></p>
                        <p className="mt-1 text-[9px] text-[var(--faint)]">Salin (tahan teks) — jangan diketik manual di HP agar tidak salah ketik.</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <p className="text-center font-mono2 text-[9.5px] text-[var(--faint)]">🔒 Sesi aman · cookie + token · anti brute-force</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Nama Bot (tampilan)" value={displayName} set={setDisplayName} placeholder="AKSESBOTMU" />
                  <Field label="Nama Developer" value={devName} set={setDevName} placeholder="Bimz Official" />
                  <Field label="Nomor Developer" value={devPhone} set={setDevPhone} placeholder="+62..." mono />
                  <Field label="Telegram Developer" value={devTele} set={setDevTele} placeholder="@username" mono />
                </div>

                <label className="block">
                  <span className="font-mono2 text-[9.5px] uppercase tracking-[0.2em] text-[var(--faint)]">Menu saat /start</span>
                  <textarea className="input mt-1 min-h-24 resize-y font-mono2 !text-[12px]" placeholder="Kosongkan untuk menu default. Variabel: {name} {bot} {dev}" value={startMenu} onChange={(e) => setStartMenu(e.target.value)} />
                </label>

                <Field label="Audio Menu saat /start (URL, maks 2GB)" value={audioUrl} set={setAudioUrl} placeholder="https://.../menu.mp3 — bot mengirim audio ini saat /start" mono />

                {/* -------- Gemini AI -------- */}
                <div className="rounded-xl border border-[var(--line2)] bg-[var(--panel)] p-3.5">
                  <div className="mb-2.5 flex items-center justify-between">
                    <p className="text-[13px] font-bold">🤖 API Key Gemini AI</p>
                    <span className={`chip !text-[9.5px] ${geminiKey.trim() || (boot?.settings as any)?.hasGeminiKey ? "!text-[var(--ok)]" : "!text-[var(--bad)]"}`}>
                      {geminiKey.trim() || (boot?.settings as any)?.hasGeminiKey ? "AKTIF" : "KOSONG"}
                    </span>
                  </div>
                  <Field label="Gemini API Key (terenkripsi AES-256)" value={geminiKey} set={setGeminiKey} placeholder="AIza... — gratis: aistudio.google.com/apikey" mono type="password" eye autoOff />
                  <label className="mt-2.5 block">
                    <span className="font-mono2 text-[9.5px] uppercase tracking-[0.2em] text-[var(--faint)]">Model AI</span>
                    <select className="input mt-1 !py-2 !text-[12.5px]" value={geminiModel} onChange={(e) => setGeminiModel(e.target.value)}>
                      {GEMINI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </label>
                  <button className="btn btn-xs mt-2.5" onClick={saveAi} disabled={busy}>💾 Simpan Gemini</button>
                </div>

                {/* -------- TMDB -------- */}
                <div className="rounded-xl border border-[var(--line2)] bg-[var(--panel)] p-3.5">
                  <div className="mb-2.5 flex items-center justify-between">
                    <p className="text-[13px] font-bold">🎬 API Key TMDB (Film)</p>
                    <span className={`chip !text-[9.5px] ${tmdbKey.trim() || (boot?.settings as any)?.hasTmdbKey ? "!text-[var(--ok)]" : "!text-[var(--bad)]"}`}>
                      {tmdbKey.trim() || (boot?.settings as any)?.hasTmdbKey ? "AKTIF" : "KOSONG"}
                    </span>
                  </div>
                  <Field label="TMDB API Key (terenkripsi AES-256)" value={tmdbKey} set={setTmdbKey} placeholder="ambil gratis di themoviedb.org/settings/api" mono type="password" eye autoOff
                    hint="Dipakai /film /movie /drakor /trailer /poster — ambil data film asli + link nonton HD" />
                  <button className="btn btn-xs mt-2.5" onClick={saveTmdb} disabled={busy}>💾 Simpan TMDB</button>
                </div>

                {/* -------- Laporan -------- */}
                <div className="rounded-xl border border-[var(--line2)] bg-[var(--panel)] p-3.5">
                  <p className="mb-2.5 text-[13px] font-bold">📩 Tujuan Laporan User</p>
                  <Field label="Chat ID Telegram penerima /report" value={reportTarget} set={setReportTarget} placeholder="contoh: 123456789 (chat ID kamu)" mono autoOff
                    hint="Saat user mengetik /report di bot, laporan otomatis dikirim ke Chat ID ini. Cara dapat ID kamu: ketik /profile di bot → salin Telegram ID." />
                </div>

                <div className="flex flex-wrap gap-2">
                  <button className={`chip cursor-pointer !py-2 ${autoAI ? "!border-[var(--text)] !bg-[var(--text)] !text-[var(--bg)]" : ""}`} onClick={() => setAutoAI(!autoAI)}>
                    🤖 Auto AI: {autoAI ? "AKTIF" : "MATI"}
                  </button>
                  <button className={`chip cursor-pointer !py-2 ${maintenance ? "!border-[var(--bad)] !text-[var(--bad)]" : ""}`} onClick={() => setMaintenance(!maintenance)}>
                    🛠️ Maintenance: {maintenance ? "AKTIF" : "MATI"}
                  </button>
                </div>
                <p className="-mt-2 font-mono2 text-[9.5px] text-[var(--faint)]">Di Telegram: /autoaion · /autoaioff · /newbot (buat bot baru) · /report (laporan user)</p>

                <div>
                  <span className="font-mono2 text-[9.5px] uppercase tracking-[0.2em] text-[var(--faint)]">Quick Reply (muncul di Live Chat)</span>
                  <div className="mt-1.5 space-y-2">
                    {qrs.map((qr, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <input className="input !w-28 !py-1.5 !text-[12px]" placeholder="trigger" value={qr.trigger} onChange={(e) => setQrs(qrs.map((x, j) => j === i ? { ...x, trigger: e.target.value } : x))} />
                        <input className="input flex-1 !py-1.5 !text-[12px]" placeholder="respon otomatis" value={qr.response} onChange={(e) => setQrs(qrs.map((x, j) => j === i ? { ...x, response: e.target.value } : x))} />
                        <button className="btn btn-xs !px-2" onClick={() => setQrs(qrs.filter((_, j) => j !== i))}><IconX size={12} /></button>
                      </div>
                    ))}
                    <button className="btn btn-xs" onClick={() => setQrs([...qrs, { trigger: "", response: "" }])}>+ Tambah Quick Reply</button>
                  </div>
                </div>

                {saved && <p className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-[12.5px] font-semibold">{saved}</p>}

                <div className="grid grid-cols-2 gap-2">
                  <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Menyimpan..." : "💾 Simpan Semua"}</button>
                  <button className="btn" onClick={exportCfg}><IconDownload size={14} /> Export JSON</button>
                  <label className="btn cursor-pointer"><IconUpload size={14} /> Import JSON
                    <input type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importCfg(f); e.target.value = ""; }} />
                  </label>
                  <button className="btn btn-danger" onClick={logout}><IconLogout size={14} /> Logout Admin</button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
