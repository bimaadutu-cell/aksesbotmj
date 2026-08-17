import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/postgres";

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false },
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);

/** Auto-create tables jika belum ada agar tidak pernah terjadi error "Failed query" */
export async function ensureTablesExist() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bot_sessions (
        id SERIAL PRIMARY KEY,
        session_key TEXT NOT NULL UNIQUE,
        owner_name TEXT DEFAULT 'Admin',
        telegram_token_enc TEXT,
        telegram_bot_id TEXT,
        telegram_bot_name TEXT,
        telegram_bot_username TEXT,
        telegram_active BOOLEAN DEFAULT false,
        whatsapp_session_id TEXT NOT NULL,
        whatsapp_phone TEXT,
        whatsapp_jid TEXT,
        whatsapp_connected BOOLEAN DEFAULT false,
        whatsapp_pairing_code TEXT,
        settings JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS bot_config (
        id INT PRIMARY KEY DEFAULT 1,
        token_enc TEXT,
        bot_id TEXT,
        bot_name TEXT,
        bot_username TEXT,
        bot_photo_path TEXT,
        description TEXT,
        mode TEXT DEFAULT 'polling',
        webhook_url TEXT,
        active BOOLEAN DEFAULT false,
        connected_at TIMESTAMPTZ,
        last_sync_at TIMESTAMPTZ,
        settings JSONB DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS tg_users (
        tg_id TEXT PRIMARY KEY,
        first_name TEXT,
        last_name TEXT,
        username TEXT,
        is_channel BOOLEAN DEFAULT false,
        photo_path TEXT,
        total_in INT DEFAULT 0,
        total_out INT DEFAULT 0,
        xp REAL DEFAULT 0,
        level INT DEFAULT 1,
        balance INT DEFAULT 0,
        last_daily TEXT,
        is_favorite BOOLEAN DEFAULT false,
        is_blacklisted BOOLEAN DEFAULT false,
        is_pinned BOOLEAN DEFAULT false,
        is_archived BOOLEAN DEFAULT false,
        first_seen TIMESTAMPTZ DEFAULT NOW(),
        last_seen TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS messages (
        id BIGSERIAL PRIMARY KEY,
        chat_id TEXT NOT NULL,
        user_id TEXT,
        tg_message_id INT,
        direction TEXT NOT NULL,
        kind TEXT DEFAULT 'text',
        text TEXT,
        caption TEXT,
        reply_to INT,
        file_path TEXT,
        file_name TEXT,
        file_size INT,
        mime TEXT,
        meta JSONB DEFAULT '{}',
        deleted_local BOOLEAN DEFAULT false,
        imported BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS error_logs (
        id SERIAL PRIMARY KEY,
        source TEXT,
        message TEXT,
        detail TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
  } catch (err) {
    console.error("Auto-migration error:", err);
  }
}
