// お知らせ（アラート）。社内の PC からだけ（トンネル経由は proxy で 403）
//   GET /api/alerts                        … { alerts: 出ているもの（新しい・見た・あとで）, counts: ベル・帯の数, last: 最後の5分ごとの判定 }
//   GET /api/alerts?states=done&limit=50   … 済みのものも（states はカンマ区切り: new,seen,snoozed,done）
//   GET /api/alerts?assignee=事務 たなか    … その人の担当（と、その人に上げられたもの）だけ
//   GET /api/alerts?count=1                … 数だけ（ベル用・軽い）
// 状態を変えるのは server action（src/app/alerts/actions.ts）
import { alertCounts, listAlerts, type AlertState } from "@/lib/db/alerts-store";
import { ensureStore } from "@/lib/db/hub-store";
import { lastTick } from "@/lib/scheduler";

const STATES: AlertState[] = ["new", "seen", "snoozed", "done"];

export async function GET(req: Request) {
  await ensureStore();
  const q = new URL(req.url).searchParams;
  const headers = { "cache-control": "no-store" };
  if (q.get("count") === "1") return Response.json({ counts: alertCounts() }, { headers });
  const states = q.get("states")?.split(",").filter((s): s is AlertState => (STATES as string[]).includes(s));
  const alerts = listAlerts({ states: states?.length ? states : undefined, assignee: q.get("assignee") ?? undefined, limit: Number(q.get("limit")) || undefined });
  return Response.json({ alerts, counts: alertCounts(), last: lastTick() ?? null }, { headers });
}
