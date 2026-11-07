// 見本の DB のコースの回る順を、効率よく回る順に直す（⑧・担当者 11/7「右へ行って左へ行って…ではなく、ぐるっと効率よく」）。
// 中身は src/lib/routes/optimize.ts の bestStopOrder（近い順 → 交差をほどく → 時間の希望）。見本の DB だけに書く。
import { loadMasters } from "@/lib/masters/seed-db";
import { orderedStops, type Stop } from "@/lib/routes/plan";
import { bestStopOrder, DEFAULT_OPTIMIZE } from "@/lib/routes/optimize";
import { getDepot, getRouteSettings, saveStops } from "@/lib/routes/store";
import { upsertMasters } from "@/lib/db/masters";

export async function tidyRoutes(): Promise<number> {
  let m = await loadMasters();
  // 架空の届け先（V001〜・動画 E4 の見本）の時間の希望を、本物に近い広さに（動画 v8.ts と同じ）。狭いままだと、どの順でも「遅れ」が並ぶ
  const wide = (m.customers ?? []).filter((c) => /^V\d{3}$/.test(c.id)).map((c, k) => ({
    ...c, deliveryWindowFrom: ["06:00", "06:30", "07:00", "07:00"][k % 4], deliveryWindowTo: ["11:00", "11:30", "12:00", "12:00"][k % 4],
  }));
  if (wide.length) {
    await upsertMasters("customers", wide as never[], "見本の準備（⑧）");
    m = await loadMasters();
  }
  const customers = (m.customers ?? []).filter((c) => c.active !== false);
  let n = 0;
  for (const course of (m.courses ?? []).filter((c) => c.active !== false)) {
    const stops = orderedStops(course, customers) as Stop[];
    if (stops.length < 3) continue;
    const ids = bestStopOrder(getDepot(), stops, { ...DEFAULT_OPTIMIZE, weekday: 1, settings: getRouteSettings() });
    await saveStops(course.id, ids, "見本の準備（⑧）");
    n++;
  }
  return n;
}
