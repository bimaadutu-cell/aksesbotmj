export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  setTimeout(async () => {
    try {
      const { ensureTablesExist } = await import("@/db");
      await ensureTablesExist();
    } catch {}
  }, 2000);
}
