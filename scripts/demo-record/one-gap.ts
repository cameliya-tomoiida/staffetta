// 見本の DB の「記録の漏れ」を1件だけにする（⑧・担当者「1件抜けています、アラームを出します、の形に」）。
// 動画 E5（v8.ts）と、見本の規模を入れるとき（demo-scale.ts）の両方で使う。見本の DB だけに書く（3100 では使わない）。
//  - 記録のアラームは「原料保管庫の温度（9:00）」だけを入れ、ほかのシート・製品カードは止める
//  - 原料保管庫の温度は、今月の1日から今日まで、きのうの分だけ空ける → 漏れはいつ見ても1件
//  - 前の決まりで出た記録のお知らせは消す（次の見直しで、今の分だけ出る）
import { getDb, kvSet } from "@/lib/db/sqlite";

const WHO = "見本の準備（⑧）";
const SHEETS = ["temp-storage", "temp-freezer-storage", "clean-storage", "clean-rice", "clean-mixing", "clean-shaping", "clean-baking", "clean-packing", "clean-shipping", "clean-fridge", "clean-pizza", "clean-pizza-oven", "check-tools", "check-last-out", "label-use-by"];
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

export function oneRecordGap(today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10), opts: { clearAllAlerts?: boolean } = {}): string {
  const db = getDb();
  const sheets: Record<string, unknown> = Object.fromEntries(SHEETS.map((id) => [id, { on: false }]));
  sheets["temp-storage"] = { on: true, times: ["09:00"], graceMin: 60, submitDay: 0 };
  kvSet("record_alarms", { sheets, cards: { on: false, doneBy: "17:00", graceMin: 60 } });
  const month = today.slice(0, 7);
  const miss = addDays(today, -1);
  const temps: Record<string, { am: number }> = {};
  for (let d = `${month}-01`; d <= today; d = addDays(d, 1)) if (d !== miss) temps[d] = { am: 18 + (Number(d.slice(8)) % 4) };
  db.prepare("DELETE FROM hygiene_records WHERE sheet_id = ? AND month = ?").run("temp-storage", month);
  db.prepare("INSERT INTO hygiene_records (sheet_id, month, json, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)").run("temp-storage", month, JSON.stringify({ temps }), new Date().toISOString(), WHO);
  kvSet("record_alarms_since", `${month}-01`);
  if (opts.clearAllAlerts) db.prepare("DELETE FROM alerts").run();
  else db.prepare("DELETE FROM alerts WHERE kind IN ('record_missing', 'record_due')").run();
  return miss;
}
