import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  bigint,
  real,
} from "drizzle-orm/pg-core";

/** Tabel sesi bot untuk multi-user / multi-session tanpa batas */
export const botSessions = pgTable("bot_sessions", {
  id: serial("id").primaryKey(),
  sessionKey: text("session_key").notNull().unique(), // e.g. uuid or custom unique name
  ownerName: text("owner_name").default("Admin"),
  
  // Telegram Session
  telegramTokenEnc: text("telegram_token_enc"),
  telegramBotId: text("telegram_bot_id"),
  telegramBotName: text("telegram_bot_name"),
  telegramBotUsername: text("telegram_bot_username"),
  telegramActive: boolean("telegram_active").default(false),

  // WhatsApp Session (Baileys 6.7.18)
  whatsappSessionId: text("whatsapp_session_id").notNull(), // folder name / id for baileys auth
  whatsappPhone: text("whatsapp_phone"),
  whatsappJid: text("whatsapp_jid"),
  whatsappConnected: boolean("whatsapp_connected").default(false),
  whatsappPairingCode: text("whatsapp_pairing_code"),

  settings: jsonb("settings").$type<BotSettings>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

/** Single row (id=1): legacy global config fallback */
export const botConfig = pgTable("bot_config", {
  id: integer("id").primaryKey().default(1),
  tokenEnc: text("token_enc"),
  botId: text("bot_id"),
  botName: text("bot_name"),
  botUsername: text("bot_username"),
  botPhotoPath: text("bot_photo_path"),
  description: text("description"),
  mode: text("mode").default("polling"),
  webhookUrl: text("webhook_url"),
  active: boolean("active").default(false),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  settings: jsonb("settings").$type<BotSettings>().default({}),
});

export interface QuickReply {
  trigger: string;
  response: string;
}

export interface BotSettings {
  displayName?: string;
  devName?: string;
  devPhone?: string;
  devTele?: string;
  startMenu?: string;
  startAudioUrl?: string;
  autoAI?: boolean;
  maintenance?: boolean;
  timezone?: string;
  language?: "id" | "en";
  quickReplies?: QuickReply[];
  blockedUsers?: string[];
  premiumUsers?: string[];
  ownerIds?: string[];
  geminiKeyEnc?: string | null;
  geminiModel?: string;
  tmdbKeyEnc?: string | null;
  reportTarget?: string;
}

/** Telegram users */
export const tgUsers = pgTable("tg_users", {
  tgId: text("tg_id").primaryKey(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  username: text("username"),
  isChannel: boolean("is_channel").default(false),
  photoPath: text("photo_path"),
  totalIn: integer("total_in").default(0),
  totalOut: integer("total_out").default(0),
  xp: real("xp").default(0),
  level: integer("level").default(1),
  balance: integer("balance").default(0),
  lastDaily: text("last_daily"),
  isFavorite: boolean("is_favorite").default(false),
  isBlacklisted: boolean("is_blacklisted").default(false),
  isPinned: boolean("is_pinned").default(false),
  isArchived: boolean("is_archived").default(false),
  firstSeen: timestamp("first_seen", { withTimezone: true }).defaultNow(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).defaultNow(),
});

/** Messages */
export const messages = pgTable("messages", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  chatId: text("chat_id").notNull(),
  userId: text("user_id"),
  tgMessageId: integer("tg_message_id"),
  direction: text("direction").notNull(), // in | out
  kind: text("kind").default("text"),
  text: text("text"),
  caption: text("caption"),
  replyTo: integer("reply_to"),
  filePath: text("file_path"),
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  mime: text("mime"),
  meta: jsonb("meta").$type<Record<string, unknown>>().default({}),
  deletedLocal: boolean("deleted_local").default(false),
  imported: boolean("imported").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const errorLogs = pgTable("error_logs", {
  id: serial("id").primaryKey(),
  source: text("source"),
  message: text("message"),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
