/** Auto-start bot engine saat server boot — bot online 24/7 walau dashboard tidak dibuka */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  setTimeout(async () => {
    try {
      const { ensureEngine } = await import("@/lib/bot/engine");
      await ensureEngine();
      const { connectWhatsApp } = await import("@/lib/whatsapp");
      await connectWhatsApp().catch(() => {});
      // keep polling alive
      setInterval(() => { ensureEngine().catch(() => {}); }, 60_000);
    } catch { /* db belum siap — akan dicoba ulang interval */ }
  }, 3500);
}
