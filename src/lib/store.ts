import { db } from "@/db";
import { botConfig, tgUsers, messages, errorLogs, type BotSettings } from "@/db/schema";
import { eq, desc, sql, and, lt, asc } from "drizzle-orm";
import { decrypt, encrypt } from "@/lib/crypto";

export const DEFAULT_SETTINGS: BotSettings = {
  displayName: "AKSESBOTMU",
  devName: "Bimz Official",
  devPhone: "-",
  devTele: "@bimzofficial",
  startMenu: "",
  startAudioUrl: "",
  autoAI: false,
  maintenance: false,
  timezone: "Asia/Jakarta",
  language: "id",
  quickReplies: [],
  blockedUsers: [],
  premiumUsers: [],
  ownerIds: [],
  geminiKeyEnc: null,
  geminiModel: "gemini-2.5-flash-lite",
  tmdbKeyEnc: null,
  reportTarget: "",
};

export interface ConfigRow {
  tokenEnc: string | null;
  botId: string | null;
  botName: string | null;
  botUsername: string | null;
  botPhotoPath: string | null;
  description: string | null;
  mode: string | null;
  webhookUrl: string | null;
  active: boolean | null;
  connectedAt: Date | null;
  lastSyncAt: Date | null;
  settings: BotSettings;
}

export async function getConfig(): Promise<ConfigRow | null> {
  const rows = await db.select().from(botConfig).where(eq(botConfig.id, 1)).limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    ...r,
    settings: { ...DEFAULT_SETTINGS, ...(r.settings ?? {}) },
  } as ConfigRow;
}

export function getToken(c: ConfigRow | null): string | null {
  if (!c?.tokenEnc) return null;
  try {
    return decrypt(c.tokenEnc);
  } catch {
    return null;
  }
}

export async function upsertConfig(data: {
  tokenEnc?: string | null;
  botId?: string;
  botName?: string;
  botUsername?: string;
  botPhotoPath?: string | null;
  description?: string | null;
  mode?: string;
  webhookUrl?: string | null;
  active?: boolean;
  connectedAt?: Date | null;
  lastSyncAt?: Date;
  settings?: BotSettings;
}) {
  const existing = await getConfig();
  if (existing) {
    await db.update(botConfig).set(data).where(eq(botConfig.id, 1));
  } else {
    await db.insert(botConfig).values({ id: 1, ...data } as any);
  }
  return getConfig();
}

export async function patchSettings(patch: Partial<BotSettings>) {
  const c = await getConfig();
  const settings = { ...(c?.settings ?? DEFAULT_SETTINGS), ...patch };
  await upsertConfig({ settings });
  return settings;
}

export async function upsertTgUser(u: {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  is_bot?: boolean;
  title?: string;
  type?: string;
}): Promise<void> {
  const tgId = String(u.id);
  const isChannel = u.type === "group" || u.type === "supergroup" || u.type === "channel";
  const firstName = u.title ?? u.first_name ?? "Unknown";
  const rows = await db.select({ id: tgUsers.tgId }).from(tgUsers).where(eq(tgUsers.tgId, tgId)).limit(1);
  if (rows.length === 0) {
    await db.insert(tgUsers).values({
      tgId, firstName, lastName: u.last_name ?? null, username: u.username ?? null,
      isChannel, lastSeen: new Date(),
    });
  } else {
    await db.update(tgUsers).set({
      firstName,
      lastName: u.last_name ?? undefined,
      username: u.username ?? undefined,
      isChannel: isChannel || undefined,
      lastSeen: new Date(),
    }).where(eq(tgUsers.tgId, tgId));
  }
}

export async function bumpUserCounter(tgId: string, dir: "in" | "out", xpGain = 0) {
  if (dir === "in") {
    await db.update(tgUsers)
      .set({ totalIn: sql`${tgUsers.totalIn} + 1`, xp: sql`${tgUsers.xp} + ${xpGain}`, lastSeen: new Date() })
      .where(eq(tgUsers.tgId, tgId));
  } else {
    await db.update(tgUsers)
      .set({ totalOut: sql`${tgUsers.totalOut} + 1`, lastSeen: new Date() })
      .where(eq(tgUsers.tgId, tgId));
  }
  // level up: level = floor(sqrt(xp/20))+1
  await db.execute(sql`UPDATE tg_users SET level = GREATEST(1, FLOOR(SQRT(GREATEST(0, xp) / 20)) + 1) WHERE tg_id = ${tgId}`);
}

export async function insertMessage(m: {
  chatId: string;
  userId?: string | null;
  tgMessageId?: number | null;
  direction: "in" | "out";
  kind?: string;
  text?: string | null;
  caption?: string | null;
  replyTo?: number | null;
  filePath?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  mime?: string | null;
  meta?: Record<string, unknown>;
  imported?: boolean;
  createdAt?: Date;
}) {
  const rows = await db.insert(messages).values({
    chatId: m.chatId,
    userId: m.userId ?? null,
    tgMessageId: m.tgMessageId ?? null,
    direction: m.direction,
    kind: m.kind ?? "text",
    text: m.text ?? null,
    caption: m.caption ?? null,
    replyTo: m.replyTo ?? null,
    filePath: m.filePath ?? null,
    fileName: m.fileName ?? null,
    fileSize: m.fileSize ?? null,
    mime: m.mime ?? null,
    meta: m.meta ?? {},
    imported: m.imported ?? false,
    createdAt: m.createdAt ?? new Date(),
  }).returning();
  return rows[0];
}

export async function getStats() {
  const [u] = await db.select({ n: sql<number>`count(*)::int` }).from(tgUsers);
  const [m] = await db.select({ n: sql<number>`count(*)::int` }).from(messages);
  const [today] = await db.select({ n: sql<number>`count(*)::int` }).from(messages)
    .where(sql`created_at >= date_trunc('day', now())`);
  const [inc] = await db.select({ n: sql<number>`count(*)::int` }).from(messages).where(eq(messages.direction, "in"));
  const [outc] = await db.select({ n: sql<number>`count(*)::int` }).from(messages).where(eq(messages.direction, "out"));
  const [chats] = await db.select({ n: sql<number>`count(distinct chat_id)::int` }).from(messages);
  const [errs] = await db.select({ n: sql<number>`count(*)::int` }).from(errorLogs);
  const hourly = await db.execute(sql`
    SELECT extract(hour from created_at)::int AS h, count(*)::int AS n
    FROM messages WHERE created_at >= now() - interval '24 hours'
    GROUP BY 1 ORDER BY 1`);
  const perUser = await db.execute(sql`
    SELECT m.user_id AS id, coalesce(u.first_name, m.user_id) AS name, count(*)::int AS n
    FROM messages m LEFT JOIN tg_users u ON u.tg_id = m.user_id
    WHERE m.created_at >= now() - interval '24 hours' AND m.user_id IS NOT NULL AND m.direction = 'in'
    GROUP BY 1,2 ORDER BY 3 DESC LIMIT 5`);
  return {
    totalUsers: Number(u?.n ?? 0),
    totalMessages: Number(m?.n ?? 0),
    messagesToday: Number(today?.n ?? 0),
    messagesIn: Number(inc?.n ?? 0),
    messagesOut: Number(outc?.n ?? 0),
    totalChats: Number(chats?.n ?? 0),
    errorCount: Number(errs?.n ?? 0),
    hourly: (hourly as any).rows ?? [],
    topUsers: (perUser as any).rows ?? [],
  };
}

export async function logError(source: string, message: string, detail?: unknown) {
  try {
    await db.insert(errorLogs).values({
      source,
      message: String(message).slice(0, 500),
      detail: detail ? String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 2000) : null,
    });
    await db.execute(sql`DELETE FROM error_logs WHERE id NOT IN (SELECT id FROM error_logs ORDER BY id DESC LIMIT 300)`);
  } catch { /* db unavailable — ignore */ }
}

export async function fullBackup() {
  const config = await getConfig();
  const users = await db.select().from(tgUsers).orderBy(asc(tgUsers.firstSeen));
  const msgs = await db.select().from(messages).orderBy(asc(messages.id));
  const logs = await db.select().from(errorLogs).orderBy(desc(errorLogs.id)).limit(100);
  return { app: "aksesbotmu", version: 1, exportedAt: new Date().toISOString(), config, users, messages: msgs, logs };
}
