import { NextResponse } from "next/server";
import { db, ensureTablesExist } from "@/db";
import { botSessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { startWhatsAppSession, requestWAPairingCode, disconnectWASession, getWAStatus, startTelegramPollingForSession } from "@/lib/multi-session";

export async function GET(req: Request) {
  await ensureTablesExist();
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");

  if (sessionId) {
    const wa = getWAStatus(sessionId);
    return NextResponse.json({ ok: true, wa });
  }

  try {
    const allSessions = await db.select().from(botSessions);
    return NextResponse.json({ ok: true, sessions: allSessions });
  } catch (e: any) {
    return NextResponse.json({ ok: true, sessions: [] });
  }
}

export async function POST(req: Request) {
  await ensureTablesExist();
  try {
    const body = await req.json();
    const { action, sessionId, ownerName, telegramToken, phone } = body;

    const sKey = sessionId?.trim() || `session-${Math.random().toString(36).substring(2, 8)}`;

    if (action === "create" || action === "update") {
      let botInfo: any = {};
      if (telegramToken) {
        const r = await fetch(`https://api.telegram.org/bot${telegramToken.trim()}/getMe`);
        const d: any = await r.json();
        if (!d.ok) return NextResponse.json({ ok: false, error: "Token Telegram tidak valid." }, { status: 400 });
        botInfo = d.result;
        startTelegramPollingForSession(sKey, telegramToken.trim());
      }

      const existing = await db.select().from(botSessions).where(eq(botSessions.sessionKey, sKey));

      if (existing.length === 0) {
        await db.insert(botSessions).values({
          sessionKey: sKey,
          ownerName: ownerName || "User Bot",
          telegramTokenEnc: telegramToken?.trim() || null,
          telegramBotId: botInfo.id ? String(botInfo.id) : null,
          telegramBotName: botInfo.first_name || null,
          telegramBotUsername: botInfo.username || null,
          telegramActive: !!telegramToken,
          whatsappSessionId: sKey,
        });
      } else {
        await db.update(botSessions).set({
          ownerName: ownerName || existing[0].ownerName,
          telegramTokenEnc: telegramToken?.trim() || existing[0].telegramTokenEnc,
          telegramBotId: botInfo.id ? String(botInfo.id) : existing[0].telegramBotId,
          telegramBotName: botInfo.first_name || existing[0].telegramBotName,
          telegramBotUsername: botInfo.username || existing[0].telegramBotUsername,
          telegramActive: telegramToken ? true : existing[0].telegramActive,
          updatedAt: new Date(),
        }).where(eq(botSessions.sessionKey, sKey));
      }

      return NextResponse.json({ ok: true, sessionId: sKey, bot: botInfo });
    }

    if (action === "pair_wa") {
      if (!phone) return NextResponse.json({ ok: false, error: "Nomor WhatsApp wajib diisi." }, { status: 400 });
      const code = await requestWAPairingCode(sKey, phone);
      const wa = getWAStatus(sKey);
      return NextResponse.json({ ok: true, pairingCode: code, wa });
    }

    if (action === "connect_wa") {
      await startWhatsAppSession(sKey);
      const wa = getWAStatus(sKey);
      return NextResponse.json({ ok: true, wa });
    }

    if (action === "disconnect_wa") {
      const logout = body.logout ?? false;
      await disconnectWASession(sKey, logout);
      const wa = getWAStatus(sKey);
      return NextResponse.json({ ok: true, wa });
    }

    return NextResponse.json({ ok: false, error: "Aksi tidak dikenal." }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
