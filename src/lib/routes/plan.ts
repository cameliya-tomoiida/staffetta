// 配送コースの地図（⑦）の計算。どれも純関数（保存も通信もしない）。
//   - 2点の直線距離（km）と、それから見積もる走る時間（分）
//   - コースの時刻表: 出発 → 各先（着く・待つ・納品・出る）→ 休けい → 帰社
//   - おすすめの順番: 近い順に並べてから、2か所を入れ替えて短くなる間くり返す（2-opt）。時間の希望に遅れる順番は避ける
// 道の上の時間（OSRM）が取れたときは legMinutes で渡す。取れないときは直線距離 × 係数 ÷ 速さ で見積もる。
import type { CourseMaster, CustomerMaster } from "@/data/types";

export interface LatLng {
  lat: number;
  lng: number;
}

/** 見積もりの決まり（画面で変えられる） */
export interface RouteSettings {
  /** 直線距離を道の距離にする係数（だいたい 1.3〜1.5） */
  roadFactor: number;
  /** 平均の速さ（km/時）。町中の配送ならだいたい 20〜30 */
  speedKmh: number;
  /** 道の上の時間（OSRM）にかける係数（信号・荷物の積み下ろしの出入りなど。1.0〜1.5） */
  trafficFactor: number;
}

export const DEFAULT_ROUTE_SETTINGS: RouteSettings = { roadFactor: 1.4, speedKmh: 25, trafficFactor: 1.2 };
export const DEFAULT_SERVICE_MINUTES = 10;

/** 工場（出発・帰る所） */
export interface Depot extends LatLng {
  name: string;
  address?: string;
}

/** 2点の直線距離（km） */
export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 直線距離から見積もる走る時間（分・小数） */
export function estimateMinutes(a: LatLng, b: LatLng, s: RouteSettings = DEFAULT_ROUTE_SETTINGS): number {
  return ((distanceKm(a, b) * s.roadFactor) / s.speedKmh) * 60;
}

export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
export const toHHMM = (min: number) => {
  const m = Math.round(min);
  const d = Math.floor(m / 1440);
  const r = ((m % 1440) + 1440) % 1440;
  return `${d > 0 ? "翌" : ""}${String(Math.floor(r / 60)).padStart(2, "0")}:${String(r % 60).padStart(2, "0")}`;
};

export type Stop = Pick<
  CustomerMaster,
  "id" | "name" | "address" | "lat" | "lng" | "deliveryWindowFrom" | "deliveryWindowTo" | "deliveryHowTo" | "deliveryCaution" | "closedWeekdays" | "deliveryTime" | "serviceMinutes"
>;

export interface TimelineRow {
  id: string;
  name: string;
  /** 何件目か（1から） */
  no: number;
  /** 前の所から走る時間（分） */
  driveMinutes: number;
  /** 前の所からの距離（km・直線 × 係数。道の距離が分かればその値） */
  km: number;
  /** 着く時刻（分） */
  arrive: number;
  /** 時間の希望より早く着いて待つ（分） */
  wait: number;
  /** 納品を始める・終える時刻（分） */
  start: number;
  leave: number;
  /** 時間の希望（まで）に遅れる分（0 なら間に合う） */
  late: number;
  /** このあとに休けい（分） */
  breakAfter: number;
  /** 位置が無いので計算に入れていない */
  noPosition: boolean;
}

export interface Timeline {
  depart: number;
  rows: TimelineRow[];
  /** 帰社の時刻（分） */
  back: number;
  /** 走る時間の合計（分） */
  driveTotal: number;
  /** 距離の合計（km） */
  kmTotal: number;
  /** 遅れる先の数 */
  lateCount: number;
  /** 道の上の時間を使ったか（false なら直線距離からの見積もり） */
  road: boolean;
}

/** 休けいを取る件目（1から）。0 なら取らない */
export function breakIndex(course: Pick<CourseMaster, "breakMinutes" | "breakAfter">, n: number): number {
  if (!course.breakMinutes || n === 0) return 0;
  return Math.min(n, Math.max(1, course.breakAfter ?? Math.ceil(n / 2)));
}

/**
 * コースの時刻表を作る。stops は回る順。位置の無い先は「走る時間 0」で納品の時間だけ足す（印を付ける）。
 * legs を渡すと、その走る時間（分）と距離（km）を使う（工場→1件目, 1→2, …, 最後→工場 の n+1 本）。
 */
export function buildTimeline(
  course: Pick<CourseMaster, "departTime" | "serviceMinutes" | "breakMinutes" | "breakAfter">,
  depot: LatLng,
  stops: Stop[],
  opts: { settings?: RouteSettings; legs?: { minutes: number; km: number }[] } = {},
): Timeline {
  const s = opts.settings ?? DEFAULT_ROUTE_SETTINGS;
  const service = course.serviceMinutes ?? DEFAULT_SERVICE_MINUTES;
  const bAt = breakIndex(course, stops.length);
  const road = !!opts.legs && opts.legs.length === stops.length + 1;
  const depart = toMin(course.departTime);
  let t = depart;
  let prev: LatLng = depot;
  let driveTotal = 0;
  let kmTotal = 0;
  const rows: TimelineRow[] = [];
  // 位置のある先だけで脚を数える（legs は位置のある先の並びで作る）
  let leg = 0;
  stops.forEach((st, i) => {
    const has = st.lat != null && st.lng != null;
    let drive = 0;
    let km = 0;
    if (has) {
      const here = { lat: st.lat!, lng: st.lng! };
      if (road) {
        drive = opts.legs![leg].minutes * s.trafficFactor;
        km = opts.legs![leg].km;
      } else {
        drive = estimateMinutes(prev, here, s);
        km = distanceKm(prev, here) * s.roadFactor;
      }
      leg++;
      prev = here;
    }
    const arrive = t + drive;
    const from = st.deliveryWindowFrom ? toMin(st.deliveryWindowFrom) : undefined;
    const to = st.deliveryWindowTo ? toMin(st.deliveryWindowTo) : undefined;
    const startAt = from != null && arrive < from ? from : arrive;
    const leave = startAt + (st.serviceMinutes ?? service);
    const late = to != null && startAt > to ? startAt - to : 0;
    const brk = i + 1 === bAt ? (course.breakMinutes ?? 0) : 0;
    rows.push({
      id: st.id, name: st.name, no: i + 1, driveMinutes: drive, km, arrive, wait: startAt - arrive, start: startAt, leave, late, breakAfter: brk, noPosition: !has,
    });
    driveTotal += drive;
    kmTotal += km;
    t = leave + brk;
  });
  let backDrive = 0;
  let backKm = 0;
  if (stops.some((st) => st.lat != null && st.lng != null)) {
    if (road) {
      backDrive = opts.legs![leg].minutes * s.trafficFactor;
      backKm = opts.legs![leg].km;
    } else {
      backDrive = estimateMinutes(prev, depot, s);
      backKm = distanceKm(prev, depot) * s.roadFactor;
    }
  }
  return {
    depart, rows, back: t + backDrive, driveTotal: driveTotal + backDrive, kmTotal: kmTotal + backKm,
    lateCount: rows.filter((r) => r.late > 0).length, road,
  };
}

/** 順番の「よさ」（小さいほどよい）: 帰社までの時間 ＋ 遅れ（1分を 30 分ぶんの重さに） */
function cost(t: Timeline) {
  return t.back - t.depart + t.rows.reduce((a, r) => a + r.late * 30, 0);
}

/**
 * おすすめの順番（取引先ID）。直線距離からの見積もりで、
 *   1) 時間の希望（まで）が早い先を少し前に寄せつつ、近い順に並べる
 *   2) 区間を逆にする（2-opt）・1件を別の場所へ動かす（or-opt）で、よくなる間くり返す
 * 位置の無い先は、最後にそのままの順で残す。
 */
export function suggestOrder(
  course: Pick<CourseMaster, "departTime" | "serviceMinutes" | "breakMinutes" | "breakAfter">,
  depot: LatLng,
  stops: Stop[],
  settings: RouteSettings = DEFAULT_ROUTE_SETTINGS,
): string[] {
  const placed = stops.filter((s) => s.lat != null && s.lng != null);
  const rest = stops.filter((s) => s.lat == null || s.lng == null);
  if (placed.length < 2) return stops.map((s) => s.id);
  const evalOrder = (o: Stop[]) => cost(buildTimeline(course, depot, o, { settings }));

  // 1) 近い順（時間の希望が早い先は距離を少し短く見る）
  const left = [...placed];
  const greedy: Stop[] = [];
  let cur: LatLng = depot;
  let t = toMin(course.departTime);
  while (left.length) {
    let best = 0;
    let bestScore = Infinity;
    left.forEach((st, i) => {
      const drive = estimateMinutes(cur, { lat: st.lat!, lng: st.lng! }, settings);
      const to = st.deliveryWindowTo ? toMin(st.deliveryWindowTo) : undefined;
      const slack = to != null ? to - (t + drive) : 240;
      const score = drive + Math.max(0, Math.min(240, slack)) * 0.1 + (slack < 0 ? -slack * 5 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    const [st] = left.splice(best, 1);
    t += estimateMinutes(cur, { lat: st.lat!, lng: st.lng! }, settings) + (course.serviceMinutes ?? DEFAULT_SERVICE_MINUTES);
    cur = { lat: st.lat!, lng: st.lng! };
    greedy.push(st);
  }

  // 2) 2-opt と or-opt（数十件なので全部ためしてよい）
  let order = greedy;
  let bestCost = evalOrder(order);
  // 今の順番のほうがよければ、そこから始める
  if (evalOrder(placed) < bestCost) {
    order = [...placed];
    bestCost = evalOrder(order);
  }
  for (let round = 0, improved = true; improved && round < 50; round++) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let k = i + 1; k < order.length; k++) {
        const cand = [...order.slice(0, i), ...order.slice(i, k + 1).reverse(), ...order.slice(k + 1)];
        const c = evalOrder(cand);
        if (c < bestCost - 0.01) {
          order = cand;
          bestCost = c;
          improved = true;
        }
      }
    }
    for (let i = 0; i < order.length; i++) {
      for (let j = 0; j < order.length; j++) {
        if (i === j) continue;
        const cand = [...order];
        const [x] = cand.splice(i, 1);
        cand.splice(j, 0, x);
        const c = evalOrder(cand);
        if (c < bestCost - 0.01) {
          order = cand;
          bestCost = c;
          improved = true;
        }
      }
    }
  }
  return [...order, ...rest].map((s) => s.id);
}

/**
 * コースの取引先を、回る順番に並べる。stops にあるものはその順、ほかの「このコースの取引先」は後ろに（ID 順）。
 * stops にあっても、もうこのコースでない先・無効の先は外す。
 */
export function orderedStops<T extends Pick<CustomerMaster, "id" | "course" | "active">>(course: Pick<CourseMaster, "id" | "stops">, customers: T[]): T[] {
  const mine = customers.filter((c) => c.course === course.id && c.active !== false);
  const byId = new Map(mine.map((c) => [c.id, c]));
  const out: T[] = [];
  for (const id of course.stops ?? []) {
    const c = byId.get(id);
    if (c) {
      out.push(c);
      byId.delete(id);
    }
  }
  return [...out, ...[...byId.values()].sort((a, b) => a.id.localeCompare(b.id))];
}
