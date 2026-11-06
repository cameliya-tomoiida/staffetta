import { connection } from "next/server";
import { loadMasters } from "@/lib/masters/seed-db";
import { getDepot, getRouteSettings, roadRoute } from "@/lib/routes/store";
import { buildTimeline, orderedStops, toHHMM, type Stop } from "@/lib/routes/plan";
import { deliversOn } from "@/lib/routes/optimize";
import { deliveryRules } from "@/lib/driver/rules";
import { todayJst } from "@/lib/clock";
import { RouteBoard, type BoardCourse } from "./RouteBoard";

export const metadata = { title: "ルート表｜STAFFETTA" };

// ルート表（⑧・担当者「全体を一度に見せるとルートが小さくて見えない。コースごとに切りかえて、所要時間・回る順番・納品の注意を、地図でもリストでも」）。
// コースを選ぶ → そのコースだけを地図いっぱいに、道に沿った線（OSRM）で。リストは 順番・届け先・着く時刻・納品の決まりの印。
// 上に1行のまとめ（出発 → 戻り・時間・km・か所）。今の時刻に、どの届け先の間にいるかを線の上の印で。「全部」はコースごとの色の線と一覧だけ。
const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#14b8a6", "#ec4899", "#84cc16", "#f97316", "#06b6d4", "#eab308", "#6366f1", "#f43f5e"];
const WD = "日月火水木金土";

export default async function RoutesPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const q = await props.searchParams;
  const today = todayJst();
  const wd = typeof q.wd === "string" && /^[0-6]$/.test(q.wd) ? Number(q.wd) : new Date(`${today}T00:00:00Z`).getUTCDay();
  const masters = await loadMasters();
  const depot = getDepot();
  const settings = getRouteSettings();
  const customers = (masters.customers ?? []).filter((c) => c.active !== false && c.lat != null && c.lng != null && (c.deliveryMethod ?? "own") === "own");

  const courses: BoardCourse[] = [];
  let ci = 0;
  for (const course of (masters.courses ?? []).filter((c) => c.active !== false && (!c.weekdays?.length || c.weekdays.includes(wd)))) {
    const stops = orderedStops(course, customers).filter((c) => deliversOn(c, wd));
    if (!stops.length) continue;
    const pts = [depot, ...stops.map((s) => ({ lat: s.lat!, lng: s.lng! })), depot];
    const road = await roadRoute(pts).catch(() => undefined);
    const tl = buildTimeline(course, depot, stops as Stop[], { settings, ...(road ? { legs: road.legs } : {}) });
    courses.push({
      id: course.id, name: course.name, color: COLORS[ci++ % COLORS.length],
      depart: toHHMM(tl.depart), back: toHHMM(tl.back), departMin: Math.round(tl.depart), backMin: Math.round(tl.back),
      minutes: Math.round(tl.back - tl.depart), km: Math.round(tl.kmTotal), late: tl.lateCount,
      road: road?.line ?? null,
      stops: tl.rows.map((r, i) => {
        const c = stops[i];
        return {
          id: r.id, no: r.no, name: r.name, lat: c.lat!, lng: c.lng!, arrive: toHHMM(r.arrive), arriveMin: r.arrive, leaveMin: r.leave, late: r.late > 0,
          badges: deliveryRules(c).filter((b) => b.kind !== "dest").map((b) => b.text),
        };
      }),
    });
  }
  return <RouteBoard courses={courses} depot={depot} weekday={WD[wd]} initial={typeof q.c === "string" ? q.c : courses[0]?.id ?? "all"} demoNow={typeof q.t === "string" && /^\d{2}:\d{2}$/.test(q.t) ? q.t : undefined} />;
}
