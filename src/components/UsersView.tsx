"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api, ev, fileProxy, fmtDate, timeAgo, type BootData, type UserRow } from "@/lib/client";
import { IconSearch, IconStar, IconBan, IconX, IconChat, IconPin, IconArchiveBox } from "@/components/icons";

export default function UsersView({ boot }: { boot: BootData }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<(UserRow & { totalMessages?: number }) | null>(null);
  const tz = boot.settings?.timezone;

  const load = async (query = q) => {
    try {
      const r = await api.get<{ users: UserRow[] }>(`/api/data?type=users&q=${encodeURIComponent(query)}`);
      setUsers(r.users);
    } catch { /* */ }
  };
  useEffect(() => { load(""); const t = setInterval(() => load(), 20_000); return () => clearInterval(t); }, []);
  useEffect(() => ev.on("stats", () => load()), [q]);

  const open = async (u: UserRow) => {
    try {
      const r = await api.get<{ user: UserRow; totalMessages: number }>(`/api/data?type=user&id=${encodeURIComponent(u.tgId)}`);
      setSel(r.user ? { ...r.user, totalMessages: r.totalMessages } : u);
    } catch { setSel(u); }
  };
  const op = async (o: string) => {
    if (!sel) return;
    await api.post("/api/actions", { action: "userOp", id: sel.tgId, op: o }).catch(() => {});
    await load();
    open({ ...sel } as UserRow);
  };

  return (
    <div className="space-y-4">
      <div className="panel flex items-center gap-3 p-3.5">
        <div className="relative flex-1">
          <IconSearch size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
          <input className="input !py-2 !pl-9 !text-[13px]" placeholder="Cari nama, username, atau Telegram ID..." value={q} onChange={(e) => { setQ(e.target.value); load(e.target.value); }} />
        </div>
        <span className="chip font-mono2 !text-[10.5px]">{users.length} user</span>
      </div>

      <div className="panel overflow-hidden">
        <div className="max-h-[calc(100vh-16rem)] overflow-y-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-[var(--bg2)] font-mono2 text-[9.5px] uppercase tracking-[0.18em] text-[var(--faint)]">
              <tr className="border-b border-[var(--line)]">
                <th className="px-4 py-3">Pengguna</th>
                <th className="hidden px-4 py-3 sm:table-cell">Telegram ID</th>
                <th className="hidden px-4 py-3 md:table-cell">Pesan</th>
                <th className="hidden px-4 py-3 lg:table-cell">Level</th>
                <th className="hidden px-4 py-3 md:table-cell">Terakhir aktif</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => (
                <motion.tr key={u.tgId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.015, 0.3) }}
                  onClick={() => open(u)}
                  className="cursor-pointer border-b border-[var(--line)] transition hover:bg-[var(--panel)]">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      {u.photoPath ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={fileProxy(u.photoPath) ?? undefined} alt="" className="h-8 w-8 rounded-full border border-[var(--line2)] object-cover" />
                      ) : (
                        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--line2)] bg-[var(--panel2)] text-[12px] font-bold">{(u.firstName ?? "?").charAt(0).toUpperCase()}</span>
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-bold">{u.firstName} {u.lastName ?? ""}</p>
                        <p className="truncate font-mono2 text-[10px] text-[var(--faint)]">{u.username ? `@${u.username}` : u.isChannel ? "grup/channel" : "tanpa username"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-4 py-2.5 font-mono2 text-[11px] text-[var(--muted)] sm:table-cell">{u.tgId}</td>
                  <td className="hidden px-4 py-2.5 font-mono2 text-[11px] text-[var(--muted)] md:table-cell">{(u.totalIn ?? 0) + (u.totalOut ?? 0)}</td>
                  <td className="hidden px-4 py-2.5 font-mono2 text-[11px] text-[var(--muted)] lg:table-cell">Lv.{u.level ?? 1}</td>
                  <td className="hidden px-4 py-2.5 font-mono2 text-[11px] text-[var(--muted)] md:table-cell">{timeAgo(u.lastSeen)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1">
                      {u.isFavorite && <span title="Favorit"><IconStar size={12} /></span>}
                      {u.isPinned && <span title="Dipin"><IconPin size={12} className="text-[var(--muted)]" /></span>}
                      {u.isBlacklisted && <span title="Blacklist" className="text-[var(--bad)]"><IconBan size={12} /></span>}
                      {!u.isFavorite && !u.isBlacklisted && !u.isPinned && <span className="font-mono2 text-[9.5px] text-[var(--faint)]">—</span>}
                    </div>
                  </td>
                </motion.tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-14 text-center font-mono2 text-[11px] text-[var(--faint)]">Belum ada pengguna. Pengguna muncul otomatis saat mengirim pesan ke bot.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {sel && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setSel(null)}>
            <motion.div initial={{ scale: 0.94, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }} className="panel neon w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3.5">
                  {sel.photoPath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={fileProxy(sel.photoPath) ?? undefined} alt="" className="h-14 w-14 rounded-full border border-[var(--line2)] object-cover" />
                  ) : (
                    <span className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--line2)] bg-[var(--panel2)] text-xl font-bold">{(sel.firstName ?? "?").charAt(0).toUpperCase()}</span>
                  )}
                  <div>
                    <p className="text-[15.5px] font-bold">{sel.firstName} {sel.lastName}</p>
                    <p className="font-mono2 text-[11px] text-[var(--muted)]">{sel.username ? `@${sel.username}` : "tanpa username"}</p>
                  </div>
                </div>
                <button onClick={() => setSel(null)} className="text-[var(--muted)] transition hover:text-[var(--text)]"><IconX size={17} /></button>
              </div>

              <div className="mt-4 space-y-2 font-mono2 text-[11.5px]">
                {[
                  ["Telegram ID", sel.tgId],
                  ["Total Pesan", String(sel.totalMessages ?? (sel.totalIn ?? 0) + (sel.totalOut ?? 0))],
                  ["Masuk / Keluar", `${sel.totalIn ?? 0} / ${sel.totalOut ?? 0}`],
                  ["Pertama menghubungi", fmtDate(sel.firstSeen, tz)],
                  ["Terakhir aktif", timeAgo(sel.lastSeen)],
                  ["Level / XP / Koin", `Lv.${sel.level ?? 1} · ${Math.round(sel.xp ?? 0)} XP · ${sel.balance ?? 0} 🪙`],
                  ["Status Favorit", sel.isFavorite ? "⭐ Favorit" : "Tidak"],
                  ["Status Blacklist", sel.isBlacklisted ? "🚫 Diblacklist" : "Aktif"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b border-[var(--line)] pb-1.5">
                    <span className="text-[var(--faint)]">{k}</span><span className="truncate text-right">{v}</span>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button className="btn btn-xs" onClick={() => op("favorite")}>{sel.isFavorite ? "Hapus Favorit" : "⭐ Favorit"}</button>
                <button className="btn btn-xs" onClick={() => op("pin")}>{sel.isPinned ? "Lepas Pin" : "📌 Pin"}</button>
                <button className="btn btn-xs" onClick={() => op("archive")}>{sel.isArchived ? "Keluarkan Arsip" : "🗄 Arsipkan"}</button>
                <button className="btn btn-xs btn-danger" onClick={() => op("blacklist")}>{sel.isBlacklisted ? "Buka Blokir" : "🚫 Blacklist"}</button>
              </div>
              <p className="mt-3 text-center font-mono2 text-[9.5px] text-[var(--faint)]">Buka chatnya lewat halaman Live Chat → cari nama/ID ini.</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
