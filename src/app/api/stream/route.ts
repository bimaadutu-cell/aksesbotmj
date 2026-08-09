import { bus } from "@/lib/bot/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Server-Sent Events — realtime message/status/stats push tanpa refresh */
export async function GET() {
  const enc = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { /* closed */ }
      };
      const onMessage = (row: unknown) => send("message", row);
      const onStats = (d: unknown) => send("stats", d);
      const onStatus = (d: unknown) => send("status", d);
      const onLog = (d: unknown) => send("log", d);
      bus.on("message", onMessage);
      bus.on("stats", onStats);
      bus.on("status", onStatus);
      bus.on("log", onLog);
      const hb = setInterval(() => send("ping", { at: Date.now() }), 20_000);
      send("hello", { at: Date.now() });
      cleanup = () => {
        clearInterval(hb);
        bus.off("message", onMessage);
        bus.off("stats", onStats);
        bus.off("status", onStatus);
        bus.off("log", onLog);
      };
    },
    cancel() { cleanup?.(); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
