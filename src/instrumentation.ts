// サーバーの起動時に1回だけ呼ばれる（Next.js の決まり）。5分ごとの判定（①の src/lib/scheduler.ts）を始める。
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startScheduler } = await import("./lib/scheduler");
  startScheduler();
}
