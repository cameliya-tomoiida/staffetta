import { connection } from "next/server";
import { loadMasters } from "@/lib/masters/seed-db";
import { getDepot, getRouteSettings, roadRoute } from "@/lib/routes/store";
import { bestSlot, buildTimeline, orderedStops, serviceForPieces, toHHMM, type Stop } from "@/lib/routes/plan";
import { allOrders } from "@/demo/all-orders";
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
  // ⑧ 11/7 担当者「日付を変えたら A コースが変わる。基準があって、追加があれば追加の届け先を入れてコースができる」
  const date = typeof q.d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.d) ? q.d : today;
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  const { orders } = await allOrders();
  const dayOrders = orders.filter((o) => o.deliveryDate === date && o.status !== "cancelled" && (o.intent ?? "new") === "new");
  const ordered = new Set(dayOrders.map((o) => o.customerId));
  // 納品にかかる時間: その日に届ける数で 5〜20分（取引先に時間が入っていればそちら）
  const pieces = new Map<string, number>();
  for (const o of dayOrders) pieces.set(o.customerId, (pieces.get(o.customerId) ?? 0) + o.lines.reduce((a, l) => a + (l.pieces || l.quantity), 0));
  const withService = <T extends { id: string; serviceMinutes?: number }>(c: T): T => ({ ...c, serviceMinutes: c.serviceMinutes ?? serviceForPieces(ordered.size ? pieces.get(c.id) ?? 0 : undefined) });
  const masters = await loadMasters();
  const depot = getDepot();
  const settings = getRouteSettings();
  const customers = (masters.customers ?? []).filter((c) => c.active !== false && c.lat != null && c.lng != null && (c.deliveryMethod ?? "own") === "own");

  const courses: BoardCourse[] = [];
  let ci = 0;
  // 便が走らない曜日でも、その便の先に注文があれば出す（定休日・便のない日の注文がルート表から落ちて運び忘れになるため。管理役2 11/7）
  for (const course of (masters.courses ?? []).filter((c) => c.active !== false && (!c.weekdays?.length || c.weekdays.includes(wd) || orderedStops(c, customers).some((x) => ordered.has(x.id))))) {
    // その日のコース: 基準（便の回る順・その曜日に届ける先）→ その日に注文がある日は、注文のある先だけ＋ふだん来ない先は「追加」で、いちばん増えない所に入れる
    const all = orderedStops(course, customers).map(withService);
    const base = all.filter((c) => deliversOn(c, wd));
    const anyOrder = all.some((c) => ordered.has(c.id));
    const extra = anyOrder ? all.filter((c) => ordered.has(c.id) && !base.includes(c)) : [];
    const stops = anyOrder ? base.filter((c) => ordered.has(c.id)) : [...base];
    for (const x of extra) stops.splice(bestSlot(depot, stops, x), 0, x);
    const added = new Set(extra.map((x) => x.id));
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
          ...(added.has(r.id) ? { added: true } : {}),
          id: r.id, no: r.no, name: r.name, lat: c.lat!, lng: c.lng!, arrive: toHHMM(r.arrive), arriveMin: r.arrive, leaveMin: r.leave, late: r.late > 0,
          badges: deliveryRules(c).filter((b) => b.kind !== "dest").map((b) => b.text),
        };
      }),
    });
  }
  return <RouteBoard key={date} courses={courses} depot={depot} weekday={WD[wd]} date={date} today={today} initial={typeof q.c === "string" ? q.c : courses[0]?.id ?? "all"} demoNow={typeof q.t === "string" && /^\d{2}:\d{2}$/.test(q.t) ? q.t : undefined} play={q.play === "1"} />;
}

