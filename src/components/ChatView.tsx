"use client";
import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api, ev, fileProxy, fmtBytes, fmtDate, fmtTime, timeAgo, EMOJIS, type BootData, type ChatRow, type MsgRow, type UserRow, type QuickReply } from "@/lib/client";
import { IconSearch, IconSend, IconSmile, IconClip, IconSticker, IconPin, IconStar, IconBan, IconX, IconCopy, IconInfo, IconReply, IconTrash, IconMegaphone, IconDownload, IconUpload, IconTelegram, IconDoc, IconMapPin, IconPoll, IconMic, IconPlay, IconArchiveBox, IconChevronLeft } from "@/components/icons";

type Filter = "all" | "favorite" | "archived" | "group";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Semua" }, { id: "favorite", label: "Favorit" }, { id: "group", label: "Grup" }, { id: "archived", label: "Arsip" },
];

export default function ChatView({ boot }: { boot: BootData }) {
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<MsgRow[]>([]);
  const [before, setBefore] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [reply, setReply] = useState<MsgRow | null>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [infoMsg, setInfoMsg] = useState<MsgRow | null>(null);
  const [bcOpen, setBcOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [userDetail, setUserDetail] = useState<(UserRow & { totalMessages?: number }) | null>(null);
  const [mobilePane, setMobilePane] = useState<"list" | "chat">("list");
  const [unread, setUnread] = useState<Record<string, number>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const tz = boot.settings?.timezone;

  /* ---------- chat list ---------- */
  const loadChats = async () => {
    try {
      const r = await api.get<{ chats: ChatRow[] }>("/api/data?type=chats");
      setChats(r.chats);
    } catch { /* */ }
  };
  useEffect(() => { loadChats(); const t = setInterval(loadChats, 30_000); return () => clearInterval(t); }, []);
  useEffect(() => ev.on("refresh-chats", loadChats), []);

  /* ---------- messages ---------- */
  const loadMsgs = async (chatId: string, beforeId?: number) => {
    try {
      const url = `/api/data?type=messages&chatId=${encodeURIComponent(chatId)}${beforeId ? `&before=${beforeId}` : ""}`;
      const r = await api.get<{ messages: MsgRow[] }>(url);
      setHasMore(r.messages.length >= 60);
      if (beforeId) setMsgs((m) => [...r.messages.filter((x) => !m.some((y) => y.id === x.id)), ...m]);
      else {
        setMsgs(r.messages);
        setBefore(r.messages[0]?.id ?? null);
      }
    } catch { /* */ }
  };
  const openChat = (chatId: string) => {
    setSel(chatId); setReply(null); setMenuFor(null);
    setMobilePane("chat");
    loadMsgs(chatId);
    setUnread((u) => ({ ...u, [chatId]: 0 }));
  };

  /* realtime append */
  useEffect(() => ev.on("message", (row: MsgRow) => {
    if (row.chatId === sel) {
      setMsgs((m) => (m.some((x) => x.id === row.id) ? m : [...m, row]));
    } else if (row.direction === "in") {
      setUnread((u) => ({ ...u, [row.chatId]: (u[row.chatId] ?? 0) + 1 }));
    }
  }), [sel]);

  /* autoscroll */
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [msgs.length, sel]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return chats.filter((c) => {
      if (filter === "favorite" && !c.is_favorite) return false;
      if (filter === "archived" && !c.is_archived) return false;
      if (filter === "group" && !c.is_channel) return false;
      if (filter === "all" && c.is_archived) return false;
      if (s && !(`${c.first_name ?? ""} ${c.username ?? ""} ${c.chat_id}`.toLowerCase().includes(s))) return false;
      return true;
    });
  }, [chats, filter, q]);

  const selChat = chats.find((c) => c.chat_id === sel) ?? null;

  /* ---------- send (dipanggil ComposerBox) ---------- */
  const send = async (text: string) => {
    if (!sel) return;
    await api.post("/api/actions", { action: "send", chatId: sel, text, replyTo: reply?.tgMessageId ?? null });
    setReply(null);
  };
  const onAttach = async (f: File) => {
    if (!sel) return;
    const fd = new FormData();
    fd.append("chatId", sel); fd.append("file", f);
    await api.upload("/api/actions", fd);
  };

  /* ---------- per-chat ops ---------- */
  const userOp = async (op: string) => {
    if (!sel) return;
    await api.post("/api/actions", { action: "userOp", id: sel, op }).catch(() => {});
    loadChats();
    if (userDetail) openUser(sel);
  };
  const openUser = async (id: string) => {
    try {
      const r = await api.get<{ user: UserRow; totalMessages: number }>(`/api/data?type=user&id=${encodeURIComponent(id)}`);
      setUserDetail(r.user ? { ...r.user, totalMessages: r.totalMessages } : null);
      setUserOpen(true);
    } catch { /* */ }
  };
  const deleteLocal = async (m: MsgRow) => {
    await api.post("/api/actions", { action: "deleteLocal", messageId: m.id }).catch(() => {});
    setMsgs((arr) => arr.filter((x) => x.id !== m.id));
    setMenuFor(null);
  };

  const exportChat = (format: "json" | "txt") => {
    if (!sel) return;
    const name = selChat?.first_name ?? sel;
    let blob: Blob;
    if (format === "json") blob = new Blob([JSON.stringify({ chatId: sel, name, exportedAt: new Date().toISOString(), messages: msgs }, null, 2)], { type: "application/json" });
    else blob = new Blob([msgs.map((m) => `[${fmtDate(m.createdAt)} ${fmtTime(m.createdAt)}] ${m.direction === "in" ? name : "BOT"}: ${m.text || m.caption || `[${m.kind}]`}`).join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `chat-${name}-${Date.now()}.${format}`;
    a.click(); URL.revokeObjectURL(a.href);
  };
  const importChat = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      const list = (data.messages ?? data).filter((m: any) => m && m.chatId && m.direction);
      const r = await api.post<{ ok: boolean; count?: number }>("/api/actions", { action: "importChat", messages: list });
      alert(`✅ ${r.count ?? list.length} pesan diimpor.`);
      if (sel) loadMsgs(sel);
      loadChats();
    } catch { alert("❌ File impor tidak valid."); }
  };

  const quickReplies: QuickReply[] = boot.settings?.quickReplies ?? [];
  const pinnedChats = filtered.filter((c) => c.is_pinned);
  const otherChats = filtered.filter((c) => !c.is_pinned);

  return (
    <div className="panel flex h-[calc(100vh-8.5rem)] overflow-hidden lg:h-[calc(100vh-7.5rem)]">
      {/* ================= sidebar ================= */}
      <aside className={`w-full shrink-0 flex-col border-r border-[var(--line)] md:flex md:w-[320px] lg:w-[350px] ${mobilePane === "chat" ? "hidden" : "flex"}`}>
        <div className="space-y-2.5 border-b border-[var(--line)] p-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <IconSearch size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
              <input className="input !py-2 !pl-9" placeholder="Cari chat / pengguna..." value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <button className="btn btn-xs !px-2.5" title="Broadcast" onClick={() => setBcOpen(true)}><IconMegaphone size={15} /></button>
          </div>
          <div className="flex gap-1.5 overflow-x-auto">
            {FILTERS.map((f) => (
              <button key={f.id} onClick={() => setFilter(f.id)} className={`chip cursor-pointer transition ${filter === f.id ? "!border-[var(--text)] !bg-[var(--text)] !text-[var(--bg)]" : "hover:!text-[var(--text)]"}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {pinnedChats.length > 0 && <p className="px-2 pb-1 pt-2 font-mono2 text-[9.5px] uppercase tracking-[0.2em] text-[var(--faint)]">📌 Disematkan</p>}
          {pinnedChats.map((c) => <ChatItem key={c.chat_id} c={c} active={sel === c.chat_id} unread={unread[c.chat_id] ?? 0} tz={tz} onOpen={openChat} />)}
          {otherChats.length > 0 && pinnedChats.length > 0 && <p className="px-2 pb-1 pt-2 font-mono2 text-[9.5px] uppercase tracking-[0.2em] text-[var(--faint)]">Chat</p>}
          {otherChats.map((c) => <ChatItem key={c.chat_id} c={c} active={sel === c.chat_id} unread={unread[c.chat_id] ?? 0} tz={tz} onOpen={openChat} />)}
          {filtered.length === 0 && (
            <p className="whitespace-pre-line py-14 text-center font-mono2 text-[11px] text-[var(--faint)]">
              {chats.length === 0 ? "Belum ada chat masuk.\nCoba kirim pesan ke bot dari Telegram." : "Tidak ada chat yang cocok."}
            </p>
          )}
        </div>
      </aside>

      {/* ================= conversation ================= */}
      <section className={`min-w-0 flex-1 flex-col ${mobilePane === "list" ? "hidden md:flex" : "flex"}`}>
        {!sel ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--line2)] bg-[var(--panel)] text-[var(--muted)]"><IconTelegram size={30} /></span>
            <p className="text-[14px] font-bold">Pilih chat untuk memulai</p>
            <p className="max-w-[260px] font-mono2 text-[11px] leading-relaxed text-[var(--faint)]">Semua pesan masuk dari Telegram muncul di sini secara real-time. Balas dengan gaya WhatsApp.</p>
          </div>
        ) : (
          <>
            {/* header */}
            <header className="flex items-center gap-2.5 border-b border-[var(--line)] px-3.5 py-2.5">
              <button className="btn btn-xs !px-2 md:hidden" onClick={() => setMobilePane("list")}><IconChevronLeft size={15} /></button>
              <button className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => openUser(sel)}>
                <Avatar path={selChat?.photo_path} name={selChat?.first_name} isChannel={!!selChat?.is_channel} size={38} />
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-bold">{selChat?.first_name ?? sel}</p>
                  <p className="truncate font-mono2 text-[10px] text-[var(--muted)]">
                    {selChat?.username ? `@${selChat.username} · ` : ""}{selChat?.is_channel ? "grup" : `ID ${sel}`} · {selChat?.total ?? 0} pesan
                  </p>
                </div>
              </button>
              <div className="flex items-center gap-1">
                <IconBtn title={selChat?.is_favorite ? "Hapus favorit" : "Favoritkan"} active={!!selChat?.is_favorite} onClick={() => userOp("favorite")}><IconStar size={15} /></IconBtn>
                <IconBtn title={selChat?.is_pinned ? "Lepas pin" : "Pin chat"} active={!!selChat?.is_pinned} onClick={() => userOp("pin")}><IconPin size={15} /></IconBtn>
                <IconBtn title={selChat?.is_blacklisted ? "Buka blokir" : "Blacklist"} active={!!selChat?.is_blacklisted} onClick={() => userOp("blacklist")}><IconBan size={15} /></IconBtn>
                <IconBtn title="Arsipkan" active={!!selChat?.is_archived} onClick={() => userOp("archive")}><IconArchiveBox size={15} /></IconBtn>
                <IconBtn title="Export JSON" onClick={() => exportChat("json")}><IconDownload size={15} /></IconBtn>
                <IconBtn title="Import chat" onClick={() => document.getElementById("import-chat")?.click()}><IconUpload size={15} /></IconBtn>
                <input id="import-chat" type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importChat(f); e.target.value = ""; }} />
              </div>
            </header>

            {/* messages */}
            <div ref={listRef} className="flex-1 space-y-1.5 overflow-y-auto px-3.5 py-4">
              {hasMore && (
                <button className="btn btn-xs mx-auto mb-2 block" onClick={() => before && loadMsgs(sel, before)}>Muat pesan sebelumnya</button>
              )}
              {msgs.map((m) => (
                <MessageBubble key={m.id} m={m} msgs={msgs} tz={tz}
                  onMenu={(id) => setMenuFor(menuFor === id ? null : id)}
                  menuOpen={menuFor === m.id}
                  onReply={() => { setReply(m); setMenuFor(null); }}
                  onCopy={() => { navigator.clipboard?.writeText(m.text || m.caption || "").catch(() => {}); setMenuFor(null); }}
                  onDelete={() => deleteLocal(m)}
                  onInfo={() => { setInfoMsg(m); setMenuFor(null); }}
                />
              ))}
            </div>

            {/* composer (komponen terpisah — keyboard tetap stabil saat mengetik) */}
            <ComposerBox
              chatName={selChat?.first_name ?? sel}
              reply={reply}
              onCancelReply={() => setReply(null)}
              quickReplies={quickReplies}
              onSend={send}
              onAttach={onAttach}
            />
          </>
        )}
      </section>

      {/* ================= modals ================= */}
      <AnimatePresence>
        {infoMsg && (
          <Modal onClose={() => setInfoMsg(null)} title="Info Pesan">
            <div className="space-y-2 font-mono2 text-[11.5px]">
              {[
                ["ID Internal", String(infoMsg.id)], ["ID Telegram", String(infoMsg.tgMessageId ?? "-")],
                ["Arah", infoMsg.direction === "in" ? "Masuk" : "Keluar"], ["Jenis", infoMsg.kind ?? "text"],
                ["Waktu", `${fmtDate(infoMsg.createdAt, tz)} ${fmtTime(infoMsg.createdAt, tz)}`],
                ["Ukuran file", fmtBytes(infoMsg.fileSize)], ["MIME", infoMsg.mime ?? "-"],
                ["Reply ke", String(infoMsg.replyTo ?? "-")],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-[var(--line)] pb-1.5"><span className="text-[var(--faint)]">{k}</span><span className="truncate text-right">{v}</span></div>
              ))}
              {infoMsg.text && <p className="whitespace-pre-wrap rounded-lg bg-[var(--panel)] p-2.5 !text-[12px]">{infoMsg.text}</p>}
            </div>
          </Modal>
        )}
        {bcOpen && <BroadcastModal onClose={() => setBcOpen(false)} />}
        {userOpen && userDetail && (
          <Modal onClose={() => setUserOpen(false)} title="Detail Pengguna">
            <div className="flex items-center gap-3.5">
              <Avatar path={userDetail.photoPath} name={userDetail.firstName} isChannel={!!userDetail.isChannel} size={56} />
              <div className="min-w-0">
                <p className="text-[15px] font-bold">{userDetail.firstName} {userDetail.lastName}</p>
                <p className="font-mono2 text-[11px] text-[var(--muted)]">{userDetail.username ? `@${userDetail.username}` : "tanpa username"}</p>
              </div>
            </div>
            <div className="mt-4 space-y-2 font-mono2 text-[11.5px]">
              {[
                ["Telegram ID", userDetail.tgId], ["Total Pesan", String(userDetail.totalMessages ?? 0)],
                ["Pesan masuk / keluar", `${userDetail.totalIn ?? 0} / ${userDetail.totalOut ?? 0}`],
                ["Pertama menghubungi", fmtDate(userDetail.firstSeen, tz)], ["Terakhir aktif", timeAgo(userDetail.lastSeen)],
                ["Level / XP", `Lv.${userDetail.level ?? 1} · ${Math.round(userDetail.xp ?? 0)} XP`],
                ["Favorit", userDetail.isFavorite ? "⭐ Ya" : "Tidak"], ["Blacklist", userDetail.isBlacklisted ? "🚫 Ya" : "Tidak"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-[var(--line)] pb-1.5"><span className="text-[var(--faint)]">{k}</span><span className="truncate text-right">{v}</span></div>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button className="btn btn-xs" onClick={() => userOp("favorite")}>{userDetail.isFavorite ? "Hapus Favorit" : "⭐ Favoritkan"}</button>
              <button className="btn btn-xs btn-danger" onClick={() => userOp("blacklist")}>{userDetail.isBlacklisted ? "Buka Blokir" : "🚫 Blacklist"}</button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ================= chat list item (level modul + memo — tidak re-mount saat mengetik) ================= */
const ChatItem = memo(function ChatItem({ c, active, unread, tz, onOpen }: {
  c: ChatRow; active: boolean; unread: number; tz?: string; onOpen: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onOpen(c.chat_id)}
      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${active ? "border-[var(--line2)] bg-[var(--panel2)]" : "border-transparent hover:bg-[var(--panel)]"}`}
    >
      <Avatar path={c.photo_path} name={c.first_name} isChannel={!!c.is_channel} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {c.is_pinned && <IconPin size={11} className="shrink-0 text-[var(--muted)]" />}
          {c.is_favorite && <IconStar size={11} className="shrink-0 text-[var(--muted)]" />}
          <p className="truncate text-[13px] font-bold">{c.first_name ?? c.chat_id}</p>
          <span className="ml-auto shrink-0 font-mono2 text-[9.5px] text-[var(--faint)]">{fmtTime(c.created_at, tz)}</span>
        </div>
        <div className="flex items-center gap-2">
          <p className="truncate text-[11.5px] text-[var(--muted)]">
            {c.direction === "out" ? "↗ " : ""}{c.text || c.caption || `[${c.kind}]`}
          </p>
          {unread > 0 && (
            <span className="ml-auto shrink-0 rounded-full bg-[var(--text)] px-1.5 py-0.5 font-mono2 text-[9px] font-bold text-[var(--bg)]">{unread}</span>
          )}
        </div>
        {c.username && <p className="truncate font-mono2 text-[9.5px] text-[var(--faint)]">@{c.username}</p>}
      </div>
    </button>
  );
});

/* ================= composer (state ketik terisolasi — keyboard mobile tidak tertutup) ================= */
function ComposerBox({ chatName, reply, onCancelReply, quickReplies, onSend, onAttach }: {
  chatName: string;
  reply: MsgRow | null;
  onCancelReply: () => void;
  quickReplies: QuickReply[];
  onSend: (text: string) => Promise<void>;
  onAttach: (f: File) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [emojiOpen, setEmojiOpen] = useState<null | "emoji" | "sticker">(null);
  const [sending, setSending] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /* saat menekan Reply dari bubble → fokus otomatis ke kolom ketik */
  useEffect(() => {
    if (reply) taRef.current?.focus();
  }, [reply]);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      await onSend(t);
      setText("");
      if (taRef.current) taRef.current.style.height = "auto";
    } catch (e: any) {
      alert(e?.message ?? "Gagal mengirim pesan");
    }
    setSending(false);
    taRef.current?.focus();
  };

  return (
    <div className="border-t border-[var(--line)]">
      {/* quick replies */}
      {quickReplies.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto border-b border-[var(--line)] px-3 py-2">
          {quickReplies.map((qr, i) => (
            <button key={i} className="chip shrink-0 cursor-pointer transition hover:!text-[var(--text)]" onClick={() => { setText(qr.response); taRef.current?.focus(); }}>
              ⚡ {qr.trigger}
            </button>
          ))}
        </div>
      )}

      {/* reply preview ala WhatsApp */}
      <AnimatePresence>
        {reply && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden bg-[var(--panel)]">
            <div className="flex items-center gap-2.5 border-b border-[var(--line)] px-3.5 py-2">
              <IconReply size={14} className="shrink-0 text-[var(--muted)]" />
              <div className="min-w-0 flex-1 border-l-2 border-[var(--text)] pl-2.5">
                <p className="font-mono2 text-[9.5px] uppercase tracking-widest text-[var(--faint)]">↩ Membalas {reply.direction === "in" ? chatName : "pesan bot"}</p>
                <p className="truncate text-[12px] text-[var(--muted)]">“{reply.text || reply.caption || `[${reply.kind}]`}”</p>
              </div>
              <button className="text-[var(--muted)] transition hover:text-[var(--text)]" onClick={onCancelReply}><IconX size={15} /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* baris ketik */}
      <div className="relative p-2.5">
        <AnimatePresence>
          {emojiOpen && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="panel absolute bottom-[62px] left-2.5 z-20 w-[300px] max-w-[calc(100vw-3rem)] p-2.5">
              <div className="mb-2 flex gap-1.5">
                <button className={`chip cursor-pointer ${emojiOpen === "emoji" ? "!bg-[var(--text)] !text-[var(--bg)]" : ""}`} onClick={() => setEmojiOpen("emoji")}><IconSmile size={12} /> Emoji</button>
                <button className={`chip cursor-pointer ${emojiOpen === "sticker" ? "!bg-[var(--text)] !text-[var(--bg)]" : ""}`} onClick={() => setEmojiOpen("sticker")}><IconSticker size={12} /> Stiker</button>
              </div>
              <div className="grid max-h-40 grid-cols-8 gap-1 overflow-y-auto">
                {EMOJIS.map((e) => (
                  <button key={e} className={`rounded-lg p-1 text-center transition hover:bg-[var(--panel2)] ${emojiOpen === "sticker" ? "text-[22px]" : "text-[19px]"}`}
                    onClick={() => {
                      if (emojiOpen === "sticker") { setText(e); setEmojiOpen(null); }
                      else { setText((t) => t + e); taRef.current?.focus(); }
                    }}>
                    {e}
                  </button>
                ))}
              </div>
              {emojiOpen === "sticker" && <p className="mt-1.5 font-mono2 text-[9px] text-[var(--faint)]">Stiker dikirim sebagai emoji besar (dirender besar oleh Telegram)</p>}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-end gap-1.5">
          <button className="btn btn-xs !px-2.5 !py-2.5" title="Emoji" onClick={() => setEmojiOpen(emojiOpen === "emoji" ? null : "emoji")}><IconSmile size={17} /></button>
          <button className="btn btn-xs !px-2.5 !py-2.5" title="Lampiran (foto/dokumen)" onClick={() => fileRef.current?.click()}><IconClip size={17} /></button>
          <button className="btn btn-xs !px-2.5 !py-2.5" title="Stiker" onClick={() => setEmojiOpen(emojiOpen === "sticker" ? null : "sticker")}><IconSticker size={17} /></button>
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onAttach(f).catch((er) => alert(er?.message ?? "Gagal mengirim file")); e.target.value = ""; }} />
          <textarea
            ref={taRef}
            rows={1}
            className="input max-h-32 flex-1 resize-none !py-2.5"
            placeholder="Tulis pesan... (Enter = kirim, Shift+Enter = baris baru)"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 128) + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
          />
          <button className="btn btn-primary !px-3.5 !py-2.5" onClick={send} disabled={!text.trim() || sending} title="Kirim">
            <IconSend size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================= pieces ================= */

function IconBtn({ children, onClick, title, active }: { children: React.ReactNode; onClick: () => void; title: string; active?: boolean }) {
  return (
    <button onClick={onClick} title={title} className={`rounded-lg border border-transparent p-1.5 transition hover:border-[var(--line)] hover:bg-[var(--panel)] ${active ? "!text-[var(--text)] bg-[var(--panel2)]" : "text-[var(--muted)]"}`}>
      {children}
    </button>
  );
}

export function Avatar({ path, name, isChannel, size = 40 }: { path?: string | null; name?: string | null; isChannel?: boolean; size?: number }) {
  const url = fileProxy(path) ?? undefined;
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={name ?? "avatar"} style={{ width: size, height: size }} className="shrink-0 rounded-full border border-[var(--line2)] object-cover" />
  ) : (
    <span style={{ width: size, height: size, fontSize: size * 0.42 }} className="flex shrink-0 items-center justify-center rounded-full border border-[var(--line2)] bg-[var(--panel2)] font-bold">
      {isChannel ? "👥" : (name ?? "?").charAt(0).toUpperCase()}
    </span>
  );
}

function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ scale: 0.94, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }} transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }} className="panel neon w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[14.5px] font-bold">{title}</h3>
          <button onClick={onClose} className="text-[var(--muted)] transition hover:text-[var(--text)]"><IconX size={17} /></button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

function BroadcastModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [target, setTarget] = useState<"all" | "favorites">("all");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [count, setCount] = useState(0);
  const go = async () => {
    if (!text.trim()) return;
    setState("sending");
    try {
      const r = await api.post<{ count: number }>("/api/actions", { action: "broadcast", text, target });
      setCount(r.count); setState("done");
      setTimeout(onClose, 1400);
    } catch { setState("idle"); alert("Gagal memulai broadcast"); }
  };
  return (
    <Modal onClose={onClose} title="📢 Broadcast Message">
      {state === "done" ? (
        <p className="py-6 text-center text-[13.5px] font-semibold text-[var(--ok)]">✅ Broadcast dimulai ke {count} user — pantau di Live Chat.</p>
      ) : (
        <>
          <textarea className="input min-h-28 resize-none" placeholder="Tulis pesan broadcast untuk semua user bot..." value={text} onChange={(e) => setText(e.target.value)} />
          <div className="mt-3 flex gap-2">
            {(["all", "favorites"] as const).map((t) => (
              <button key={t} className={`chip cursor-pointer ${target === t ? "!bg-[var(--text)] !text-[var(--bg)]" : ""}`} onClick={() => setTarget(t)}>
                {t === "all" ? "Semua user" : "⭐ Favorit saja"}
              </button>
            ))}
          </div>
          <button className="btn btn-primary mt-4 w-full" onClick={go} disabled={!text.trim() || state === "sending"}>
            {state === "sending" ? "Memulai..." : "Kirim Broadcast"}
          </button>
        </>
      )}
    </Modal>
  );
}

/* ---------- message bubble with all types + action menu ---------- */
function MessageBubble({ m, msgs, tz, onMenu, menuOpen, onReply, onCopy, onDelete, onInfo }: {
  m: MsgRow; msgs: MsgRow[]; tz?: string;
  onMenu: (id: number) => void; menuOpen: boolean;
  onReply: () => void; onCopy: () => void; onDelete: () => void; onInfo: () => void;
}) {
  const out = m.direction === "out";
  const replied = m.replyTo ? msgs.find((x) => x.tgMessageId === m.replyTo) : null;
  const img = ["photo", "sticker", "gif"].includes(m.kind ?? "") ? (fileProxy(m.filePath) ?? undefined) : undefined;
  const media = ["voice", "audio"].includes(m.kind ?? "") ? (fileProxy(m.filePath) ?? undefined) : undefined;
  const video = m.kind === "video" ? (fileProxy(m.filePath) ?? undefined) : undefined;
  const loc = m.kind === "location" ? (m.meta as any) : null;
  const poll = m.kind === "poll" ? (m.meta?.poll as any) : null;
  const small = m.kind === "sticker";

  return (
    <div className={`group flex ${out ? "justify-end" : "justify-start"}`}>
      <div className="relative max-w-[85%] sm:max-w-[70%]">
        <div className={`bubble ${out ? "bubble-out" : "bubble-in"} ${small ? "!bg-transparent !border-0 !p-0" : ""}`}>
          {replied && (
            <div className={`mb-1.5 rounded-md border-l-2 px-2 py-1 text-[11px] ${out ? "border-[var(--bg)]/60 bg-[var(--bg)]/10" : "border-[var(--text)]/50 bg-[var(--panel)]"}`}>
              <p className={`font-mono2 text-[9px] uppercase tracking-widest ${out ? "opacity-70" : "text-[var(--faint)]"}`}>↩ Balasan</p>
              <p className="truncate opacity-80">{replied.text || replied.caption || `[${replied.kind}]`}</p>
            </div>
          )}

          {img && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img} alt={m.kind ?? "media"} className={`mb-1 rounded-lg border ${out ? "border-[var(--bg)]/20" : "border-[var(--line)]"} object-cover`} style={{ maxWidth: small ? 170 : 300, maxHeight: 300 }} loading="lazy" />
          )}
          {video && (
            <video src={video} controls className="mb-1 max-h-64 w-full max-w-[300px] rounded-lg bg-black" />
          )}
          {media && (
            <div className="mb-1 flex items-center gap-2">
              <span className={`flex h-8 w-8 items-center justify-center rounded-full ${out ? "bg-[var(--bg)]/15" : "bg-[var(--panel2)]"}`}>
                {m.kind === "voice" ? <IconMic size={15} /> : <IconPlay size={15} />}
              </span>
              <audio src={media} controls className="h-8 max-w-[220px]" />
            </div>
          )}
          {m.kind === "document" && (
            <a href={fileProxy(m.filePath) ?? "#"} download={m.fileName ?? "file"} target="_blank" rel="noreferrer" className={`mb-1 flex items-center gap-2.5 rounded-lg border px-3 py-2 ${out ? "border-[var(--bg)]/25 bg-[var(--bg)]/10" : "border-[var(--line)] bg-[var(--panel)]"}`}>
              <IconDoc size={18} />
              <span className="min-w-0">
                <span className="block max-w-[180px] truncate text-[12px] font-bold">{m.fileName ?? "Dokumen"}</span>
                <span className="block font-mono2 text-[9.5px] opacity-70">{fmtBytes(m.fileSize)} · unduh</span>
              </span>
            </a>
          )}
          {loc && (
            <a href={`https://www.google.com/maps?q=${loc.lat},${loc.lng}`} target="_blank" rel="noreferrer" className={`mb-1 flex items-center gap-2 rounded-lg border px-3 py-2 ${out ? "border-[var(--bg)]/25 bg-[var(--bg)]/10" : "border-[var(--line)] bg-[var(--panel)]"}`}>
              <IconMapPin size={17} /> <span className="text-[12px] font-semibold">Buka lokasi di Maps ({Number(loc.lat).toFixed(4)}, {Number(loc.lng).toFixed(4)})</span>
            </a>
          )}
          {poll && (
            <div className={`mb-1 rounded-lg border px-3 py-2 ${out ? "border-[var(--bg)]/25 bg-[var(--bg)]/10" : "border-[var(--line)] bg-[var(--panel)]"}`}>
              <p className="flex items-center gap-1.5 text-[12.5px] font-bold"><IconPoll size={14} /> {String(poll.question)}</p>
              {((poll.options ?? []) as any[]).map((o, i) => <p key={i} className="mt-0.5 text-[11.5px] opacity-80">• {o.text}</p>)}
            </div>
          )}
          {m.kind === "contact" && (
            <div className={`mb-1 rounded-lg border px-3 py-2 ${out ? "border-[var(--bg)]/25 bg-[var(--bg)]/10" : "border-[var(--line)] bg-[var(--panel)]"}`}>
              <p className="text-[12.5px] font-bold">📇 {(m.meta as any)?.contactName ?? "Kontak"}</p>
              <p className="font-mono2 text-[11px] opacity-80">{(m.meta as any)?.phone}</p>
            </div>
          )}

          {(m.text || m.caption) && !(["location", "contact", "poll"].includes(m.kind ?? "")) && (
            <p className="whitespace-pre-wrap break-words text-[13.5px]">{m.text || m.caption}</p>
          )}
          {!m.text && !m.caption && !img && !media && !video && !loc && !poll && m.kind !== "document" && m.kind !== "contact" && (
            <p className="text-[12px] italic opacity-60">[{m.kind}]</p>
          )}

          <span className={`mt-0.5 block text-right font-mono2 text-[8.5px] ${out ? "opacity-60" : "text-[var(--faint)]"}`}>{fmtTime(m.createdAt, tz)}</span>
        </div>

        {/* action trigger */}
        <button onClick={() => onMenu(m.id)} className={`absolute top-1 ${out ? "-left-7" : "-right-7"} rounded-md border border-transparent p-1 text-[var(--faint)] opacity-0 transition group-hover:opacity-100 hover:border-[var(--line)] hover:bg-[var(--panel)] hover:text-[var(--text)] ${menuOpen ? "!opacity-100" : ""}`} title="Aksi pesan">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
        </button>

        <AnimatePresence>
          {menuOpen && (
            <motion.div initial={{ opacity: 0, scale: 0.9, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.13 }}
              className={`panel absolute z-30 mt-1 w-40 overflow-hidden !rounded-xl p-1 ${out ? "right-0" : "left-0"} top-7`}>
              {[
                { icon: IconReply, label: "Reply", fn: onReply },
                { icon: IconCopy, label: "Copy", fn: onCopy },
                { icon: IconTrash, label: "Delete Lokal", fn: onDelete },
                { icon: IconInfo, label: "Info Pesan", fn: onInfo },
              ].map((a) => (
                <button key={a.label} onClick={a.fn} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-semibold transition hover:bg-[var(--panel2)]">
                  <a.icon size={14} className="text-[var(--muted)]" /> {a.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
