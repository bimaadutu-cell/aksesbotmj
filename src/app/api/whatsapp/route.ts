import { NextRequest } from "next/server";
import { connectWhatsApp, requestWhatsAppPairingCode, disconnectWhatsApp, getWhatsAppStatus } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  await connectWhatsApp().catch(() => {});
  return Response.json({ ok: true, ...getWhatsAppStatus() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "connect") {
      await connectWhatsApp();
      return Response.json({ ok: true, ...getWhatsAppStatus() });
    }
    if (body.action === "pair") {
      const code = await requestWhatsAppPairingCode(String(body.phone || ""));
      return Response.json({ ok: true, pairingCode: code, ...getWhatsAppStatus() });
    }
    if (body.action === "disconnect") {
      await disconnectWhatsApp(false);
      return Response.json({ ok: true, ...getWhatsAppStatus() });
    }
    if (body.action === "logout") {
      await disconnectWhatsApp(true);
      return Response.json({ ok: true, ...getWhatsAppStatus() });
    }
    return Response.json({ error: "Aksi tidak dikenal." }, { status: 400 });
  } catch (e: any) {
    return Response.json({ error: e?.message || "WhatsApp gagal diproses." }, { status: 400 });
  }
}
