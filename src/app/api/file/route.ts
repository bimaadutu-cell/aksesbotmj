import { NextRequest } from "next/server";
import { currentToken } from "@/lib/bot/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OK_PREFIX = ["photos/", "stickers/", "documents/", "videos/", "voice/", "video_notes/", "audio/", "animations/", "profiles/"];

/** Proxy file Telegram (foto profil, gambar pesan, stiker) agar bisa dirender di UI */
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path") ?? "";
  if (!OK_PREFIX.some((p) => path.startsWith(p)) || path.includes("..")) {
    return Response.json({ error: "invalid path" }, { status: 400 });
  }
  const token = await currentToken();
  if (!token) return Response.json({ error: "bot belum terhubung" }, { status: 400 });
  try {
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${path}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return Response.json({ error: "file tidak ditemukan" }, { status: 404 });
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get("content-type") ?? "application/octet-stream";
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": mime, "Cache-Control": "public, max-age=604800, immutable" },
    });
  } catch {
    return Response.json({ error: "gagal mengambil file" }, { status: 502 });
  }
}
