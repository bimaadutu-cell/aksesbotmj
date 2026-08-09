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

/** Single row (id=1): the connected bot + admin configuration */
export const botConfig = pgTable("bot_config", {
  id: integer("id").primaryKey().default(1),
  tokenEnc: text("token_enc"),
  botId: text("bot_id"),
  botName: text("bot_name"),
  botUsername: text("bot_username"),
  botPhotoPath: text("bot_photo_path"),
  description: text("description"),
  mode: text("mode").default("polling"), // polling | webhook
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

/** Telegram users that have interacted with the bot */
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

/** Every message (incoming from users, outgoing from bot) */
export const messages = pgTable("messages", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  chatId: text("chat_id").notNull(),
  userId: text("user_id"),
  tgMessageId: integer("tg_message_id"),
  direction: text("direction").notNull(), // in | out
  kind: text("kind").default("text"), // text photo sticker video voice audio document location contact poll gif
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
