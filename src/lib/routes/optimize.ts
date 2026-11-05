// コースの見直し（⑦の(17)）。曜日ごとに、自社便で回る先を「何コースに分けて・どの順で・何時に出るか」を出す。純関数。
//
// 時間の希望（何時〜何時）つきの巡回の問題。外のサービスは使わず、素直なやり方で解く:
//   1) 作る: 締めの早い先を種にしてコースを1つ始め、「走る時間がいちばん増えない所」に、時間の希望を守れる先を1件ずつ入れる。
//            入らなくなったら次のコースを始める（コース数を決めたときは、その数まで）
//   2) 減らす: いちばん小さいコースの先を、ほかのコースに入れ直せるなら、そのコースをなくす
//   3) 直す: 1件を別のコースへ移す・コースの中で順番を入れ替える（よくなる間くり返す）
//   4) 出発: 全部の先の時間の希望に間に合う、いちばん遅い出発の時刻（早朝の出社を減らすため）
// 走る時間は直線距離 × 係数 ÷ 速さ（plan.ts と同じ）。地図に出すときは道の上の時間で引き直す。
// 時間の希望が無く「納品時刻」だけある先は、納品時刻 ＋ deadlineSlack 分 を締めとして扱う（昔のコース表は時刻だけのため）。
import type { CourseMaster } from "@/data/types";
import { breakIndex, buildTimeline, DEFAULT_SERVICE_MINUTES, estimateMinutes, toHHMM, toMin, type LatLng, type RouteSettings, type Stop, type Timeline } from "./plan";

export interface OptimizeOptions {
  /** 曜日（0=日〜6=土） */
  weekday: number;
  /** コースの数（空なら、できるだけ少なく） */
  courses?: number;
  /** いちばん早い出発（これより前には出ない） */
  earliestDepart: string;
  /** 出発から帰社までの上限（時間） */
  maxHours: number;
  /** 1件の納品の時間の既定（分）。取引先ごとの値があればそちら */
  serviceMinutes: number;
  /** 時間の希望が無く納品時刻だけの先: 納品時刻 ＋ この分 を締めにする。負なら締めにしない */
  deadlineSlack: number;
  /** 休けい（分）。コースの真ん中で取る */
  breakMinutes: number;
  settings: RouteSettings;
}

export const DEFAULT_OPTIMIZE: Omit<OptimizeOptions, "weekday" | "settings"> = {
  earliestDepart: "04:00", maxHours: 7, serviceMinutes: DEFAULT_SERVICE_MINUTES, deadlineSlack: 30, breakMinutes: 0,
};

export type OptStop = Stop & { deliveryWeekdays?: number[]; course?: string };

export interface RoutePlan {
  name: string;
  ids: string[];
  /** 出発の時刻（分）。見直し案では、間に合ういちばん遅い出発 */
  depart: number;
  /** 間に合ういちばん遅い出発（間に合わない先があるなら undefined） */
  latestDepart?: number;
  timeline: Timeline;
}

export interface Summary {
  routes: number;
  stops: number;
  driveMinutes: number;
  km: number;
  /** 出発から帰社までの合計（分）。人が働く時間の目安 */
  workMinutes: number;
  firstDepart?: number;
  lastBack?: number;
  late: number;
}

export interface OptimizeResult {
  routes: RoutePlan[];
  /** 入らなかった先（時間の希望に間に合わない・上限の時間を超える） */
  unassigned: { id: string; name: string; reason: string }[];
  summary: Summary;
}

/** その曜日に回る先か（定休日・納品する曜日） */
export function deliversOn(s: Pick<OptStop, "closedWeekdays" | "deliveryWeekdays">, weekday: number) {
  if (s.closedWeekdays?.includes(weekday)) return false;
  return !s.deliveryWeekdays?.length || s.deliveryWeekdays.includes(weekday);
}

/** 締めとして扱う時間の希望（納品時刻だけの先は ＋slack） */
export function effectiveStop(s: Stop, slack: number): Stop {
  if (s.deliveryWindowTo || !s.deliveryTime || slack < 0) return s;
  return { ...s, deliveryWindowTo: toHHMM(toMin(s.deliveryTime) + slack).replace("翌", "") };
}

// ───────── 速い評価（距離の表を先に作る） ─────────

interface Ctx {
  n: number;
  /** 0 = 工場、1..n = 先 */
  drive: number[][];
  from: number[];
  to: number[];
  service: number[];
  o: OptimizeOptions;
  earliest: number;
}

function makeCtx(depot: LatLng, stops: Stop[], o: OptimizeOptions): Ctx {
  const pts: LatLng[] = [depot, ...stops.map((s) => ({ lat: s.lat!, lng: s.lng! }))];
  const drive = pts.map((a) => pts.map((b) => estimateMinutes(a, b, o.settings)));
  return {
    n: stops.length, drive, o, earliest: toMin(o.earliestDepart),
    from: [0, ...stops.map((s) => (s.deliveryWindowFrom ? toMin(s.deliveryWindowFrom) : -Infinity))],
    to: [0, ...stops.map((s) => (s.deliveryWindowTo ? toMin(s.deliveryWindowTo) : Infinity))],
    service: [0, ...stops.map((s) => s.serviceMinutes ?? o.serviceMinutes)],
  };
}

/** 出発 depart で回ったときの 帰社・遅れ（分の合計）・走る時間 */
function simulate(c: Ctx, route: number[], depart: number) {
  let t = depart;
  let prev = 0;
  let late = 0;
  let drive = 0;
  const bAt = breakIndex({ breakMinutes: c.o.breakMinutes }, route.length);
  route.forEach((v, i) => {
    drive += c.drive[prev][v];
    t += c.drive[prev][v];
    if (t < c.from[v]) t = c.from[v];
    if (t > c.to[v]) late += t - c.to[v];
    t += c.service[v];
    if (i + 1 === bAt) t += c.o.breakMinutes;
    prev = v;
  });
  drive += c.drive[prev][0];
  return { back: t + c.drive[prev][0], late, drive };
}

/** 間に合ういちばん遅い出発（5分きざみ）。いちばん早い出発でも遅れるなら undefined */
function latest(c: Ctx, route: number[]): number | undefined {
  if (simulate(c, route, c.earliest).late > 0.01) return undefined;
  let lo = c.earliest;
  let hi = c.earliest + 14 * 60;
  if (simulate(c, route, hi).late <= 0.01) return hi;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (simulate(c, route, mid).late <= 0.01) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo / 5) * 5;
}

/** コースのよさ（小さいほどよい）: 間に合ういちばん遅い出発で回ったときの、出発から帰社まで。だめなら undefined */
function routeCost(c: Ctx, route: number[]): { cost: number; depart: number } | undefined {
  if (!route.length) return { cost: 0, depart: c.earliest };
  const d = latest(c, route);
  if (d == null) return undefined;
  const s = simulate(c, route, d);
  const work = s.back - d;
  if (work > c.o.maxHours * 60) return undefined;
  // 働く時間 ＋ 走る時間を少し重く（同じ時間なら走らない方）
  return { cost: work + s.drive * 0.2, depart: d };
}

/** コースの中の順番を直す（2-opt と 1件の移動） */
function improveRoute(c: Ctx, route: number[]): number[] {
  let best = route;
  let bestCost = routeCost(c, route)?.cost ?? Infinity;
  for (let round = 0, better = true; better && round < 20; round++) {
    better = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const cand = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        const cc = routeCost(c, cand)?.cost;
        if (cc != null && cc < bestCost - 0.01) [best, bestCost, better] = [cand, cc, true];
      }
    }
    for (let i = 0; i < best.length; i++) {
      for (let j = 0; j < best.length; j++) {
        if (i === j) continue;
        const cand = [...best];
        const [x] = cand.splice(i, 1);
        cand.splice(j, 0, x);
        const cc = routeCost(c, cand)?.cost;
        if (cc != null && cc < bestCost - 0.01) [best, bestCost, better] = [cand, cc, true];
      }
    }
  }
  return best;
}

/** いちばんよい入れ場所（増える分・位置）。入らなければ undefined */
function bestInsert(c: Ctx, route: number[], v: number): { delta: number; pos: number } | undefined {
  const base = routeCost(c, route)?.cost ?? 0;
  let best: { delta: number; pos: number } | undefined;
  for (let p = 0; p <= route.length; p++) {
    const cand = [...route.slice(0, p), v, ...route.slice(p)];
    const rc = routeCost(c, cand);
    if (rc && (!best || rc.cost - base < best.delta)) best = { delta: rc.cost - base, pos: p };
  }
  return best;
}

/**
 * 見直し案を作る。stops は、その曜日に自社便で回る先（位置のある先だけ。呼ぶ前に deliversOn で絞る）。
 */
export function optimizeRoutes(depot: LatLng, stopsIn: Stop[], o: OptimizeOptions): OptimizeResult {
  const stops = stopsIn.filter((s) => s.lat != null && s.lng != null).map((s) => effectiveStop(s, o.deadlineSlack));
  const c = makeCtx(depot, stops, o);
  const unassigned: OptimizeResult["unassigned"] = [];
  const pool = new Set<number>();
  for (let v = 1; v <= c.n; v++) {
    // 1件だけでも回れない先は、はじめから外す
    if (!routeCost(c, [v])) unassigned.push({ id: stops[v - 1].id, name: stops[v - 1].name, reason: reasonAlone(c, v) });
    else pool.add(v);
  }
  const maxRoutes = o.courses && o.courses > 0 ? o.courses : Infinity;
  const routes: number[][] = [];

  // 1) 作る
  while (pool.size && routes.length < maxRoutes) {
    // 種: 締めがいちばん早い先（同じなら工場から遠い先）
    const seed = [...pool].sort((a, b) => c.to[a] - c.to[b] || c.drive[0][b] - c.drive[0][a])[0];
    const r = [seed];
    pool.delete(seed);
    for (;;) {
      let pick: { v: number; pos: number; score: number } | undefined;
      for (const v of pool) {
        const ins = bestInsert(c, r, v);
        if (!ins) continue;
        // 遠い先を先に入れる（あとで入れにくいから）: 増える分 − 工場からの距離 × 0.3
        const score = ins.delta - c.drive[0][v] * 0.3;
        if (!pick || score < pick.score) pick = { v, pos: ins.pos, score };
      }
      if (!pick) break;
      r.splice(pick.pos, 0, pick.v);
      pool.delete(pick.v);
    }
    routes.push(r);
  }
  // コースの数を決めたとき、入りきらなかった先
  for (const v of pool) {
    // どこかに入れられるなら入れる（上の順で入らなかっただけのもの）
    let best: { ri: number; pos: number; delta: number } | undefined;
    routes.forEach((r, ri) => {
      const ins = bestInsert(c, r, v);
      if (ins && (!best || ins.delta < best.delta)) best = { ri, ...ins };
    });
    if (best) routes[best.ri].splice(best.pos, 0, v);
    else unassigned.push({ id: stops[v - 1].id, name: stops[v - 1].name, reason: `${routes.length}コースでは、時間の希望か上限の ${o.maxHours} 時間に収まりません` });
  }

  // 2) 減らす（コースの数を決めていないとき）
  if (!o.courses) {
    for (let changed = true; changed && routes.length > 1; ) {
      changed = false;
      const order = routes.map((r, i) => [r.length, i] as const).sort((a, b) => a[0] - b[0]);
      for (const [, ri] of order) {
        const others = routes.map((r) => [...r]);
        const victims = others.splice(ri, 1)[0];
        let ok = true;
        for (const v of victims) {
          let best: { ri: number; pos: number; delta: number } | undefined;
          others.forEach((r, j) => {
            const ins = bestInsert(c, r, v);
            if (ins && (!best || ins.delta < best.delta)) best = { ri: j, ...ins };
          });
          if (!best) {
            ok = false;
            break;
          }
          others[best.ri].splice(best.pos, 0, v);
        }
        if (ok) {
          routes.splice(0, routes.length, ...others);
          changed = true;
          break;
        }
      }
    }
  }

  // 3) 直す: 1件を別のコースへ移す ＋ コースの中の順番
  for (let i = 0; i < routes.length; i++) routes[i] = improveRoute(c, routes[i]);
  for (let round = 0, better = true; better && round < 5; round++) {
    better = false;
    for (let a = 0; a < routes.length; a++) {
      for (const v of [...routes[a]]) {
        const without = routes[a].filter((x) => x !== v);
        const costA = routeCost(c, routes[a])!.cost;
        const costA2 = routeCost(c, without)?.cost;
        if (costA2 == null) continue;
        for (let b = 0; b < routes.length; b++) {
          if (a === b) continue;
          const ins = bestInsert(c, routes[b], v);
          if (ins && costA2 - costA + ins.delta < -0.5) {
            routes[a] = without;
            routes[b].splice(ins.pos, 0, v);
            better = true;
            break;
          }
        }
      }
    }
    for (let i = 0; i < routes.length; i++) routes[i] = improveRoute(c, routes[i]);
  }

  const plans: RoutePlan[] = routes
    .filter((r) => r.length)
    .map((r) => {
      const d = latest(c, r) ?? c.earliest;
      return { r, d };
    })
    .sort((x, y) => x.d - y.d)
    .map(({ r, d }, i) => {
      const ordered = r.map((v) => stops[v - 1]);
      const timeline = buildTimeline({ departTime: toHHMM(d), serviceMinutes: o.serviceMinutes, breakMinutes: o.breakMinutes }, depot, ordered, { settings: o.settings });
      return { name: `案${i + 1}`, ids: ordered.map((s) => s.id), depart: d, latestDepart: d, timeline };
    });
  return { routes: plans, unassigned, summary: summarize(plans) };
}

function reasonAlone(c: Ctx, v: number) {
  const s = simulate(c, [v], c.earliest);
  if (s.late > 0) return `いちばん早い出発（${toHHMM(c.earliest)}）でも、時間の希望（${toHHMM(c.to[v])}まで）に間に合いません`;
  return `往復だけで上限の ${c.o.maxHours} 時間を超えます`;
}

export function summarize(routes: Pick<RoutePlan, "timeline" | "ids">[]): Summary {
  const t = routes.map((r) => r.timeline).filter((x) => x.rows.length);
  return {
    routes: t.length,
    stops: routes.reduce((a, r) => a + r.ids.length, 0),
    driveMinutes: t.reduce((a, x) => a + x.driveTotal, 0),
    km: t.reduce((a, x) => a + x.kmTotal, 0),
    workMinutes: t.reduce((a, x) => a + (x.back - x.depart), 0),
    ...(t.length ? { firstDepart: Math.min(...t.map((x) => x.depart)), lastBack: Math.max(...t.map((x) => x.back)) } : {}),
    late: t.reduce((a, x) => a + x.lateCount, 0),
  };
}

/**
 * 今のコース（その曜日に走る便）の時刻表。順番は保存してある順。出発は便の出発時刻。
 * 比べるために、同じ締めの扱い（effectiveStop）と、間に合ういちばん遅い出発も出す。
 */
export function currentRoutes(
  depot: LatLng,
  courses: Pick<CourseMaster, "id" | "name" | "departTime" | "serviceMinutes" | "breakMinutes" | "breakAfter" | "weekdays" | "stops" | "dayOffset">[],
  customers: OptStop[],
  o: OptimizeOptions,
): RoutePlan[] {
  return courses
    .filter((cs) => cs.dayOffset === 0 && (!cs.weekdays?.length || cs.weekdays.includes(o.weekday)))
    .map((cs) => {
      const mine = customers.filter((x) => x.course === cs.id && x.lat != null && deliversOn(x, o.weekday));
      const byId = new Map(mine.map((x) => [x.id, x]));
      const ids = [...(cs.stops ?? []).filter((id) => byId.has(id)), ...mine.map((x) => x.id).filter((id) => !(cs.stops ?? []).includes(id)).sort()];
      const ordered = ids.map((id) => effectiveStop(byId.get(id)!, o.deadlineSlack));
      const course = { departTime: cs.departTime, serviceMinutes: cs.serviceMinutes ?? o.serviceMinutes, breakMinutes: cs.breakMinutes, breakAfter: cs.breakAfter };
      const timeline = buildTimeline(course, depot, ordered, { settings: o.settings });
      const c = makeCtx(depot, ordered, { ...o, breakMinutes: cs.breakMinutes ?? 0, serviceMinutes: course.serviceMinutes });
      const lat = ordered.length ? latest(c, ordered.map((_, i) => i + 1)) : undefined;
      return { name: cs.name, ids, depart: toMin(cs.departTime), ...(lat != null ? { latestDepart: lat } : {}), timeline };
    })
    .filter((r) => r.ids.length);
}
