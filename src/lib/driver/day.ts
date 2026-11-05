// 配送スタッフの画面（/driver）の「その日の配送」。純関数（保存も通信もしない）。
// - 回る順は ⑦ の便のマスタ（stops）。その日に届けない先（定休日・納品する曜日でない）は「お休み」として後ろに残す
// - 着く時刻の目安は ⑦ の buildTimeline（直線距離 × 係数 ÷ 速さ。道の上の時間は使わない＝スマホで速く出すため）
// - 各先に渡す商品と数は、その日の注文（確定・要確認・仮発注。変更・取消の連絡そのものは数えない）
import type { CourseMaster, CustomerMaster, Order } from "@/data/types";
import { deliversOn } from "@/lib/routes/optimize";
import { buildTimeline, orderedStops, toHHMM, type LatLng, type RouteSettings } from "@/lib/routes/plan";

export interface DriverDayItem {
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  /** 注文の状態（要確認・仮発注は印を付ける） */
  status: "confirmed" | "needs_review" | "provisional";
}

export interface DriverDayStop {
  id: string;
  name: string;
  /** 回る順（1から）。お休みの先は 0 */
  no: number;
  off: boolean;
  /** 着く時刻の目安 "HH:MM"（位置が無い先・お休みは空） */
  arrive?: string;
  /** 時間の希望に遅れそう（分） */
  late: number;
  window?: string;
  address?: string;
  howTo?: string;
  caution?: string;
  closedDays?: string;
  fax?: string;
  lat?: number;
  lng?: number;
  items: DriverDayItem[];
}

export interface DriverDay {
  courseId: string;
  courseName: string;
  depart: string;
  /** 帰社の目安 */
  back?: string;
  /** このコースはこの曜日に走らない */
  courseOff: boolean;
  vehicle?: string;
  stops: DriverDayStop[];
}

const W = "日月火水木金土";

export function driverDay(input: {
  course: CourseMaster;
  customers: CustomerMaster[];
  orders: Order[];
  date: string;
  depot: LatLng;
  settings?: RouteSettings;
  product: (id: string) => { name: string; unit: string } | undefined;
}): DriverDay {
  const { course, date } = input;
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  const all = orderedStops(course, input.customers);
  const on = all.filter((c) => deliversOn(c, wd));
  const off = all.filter((c) => !deliversOn(c, wd));
  const tl = buildTimeline(course, input.depot, on, { settings: input.settings });
  const row = new Map(tl.rows.map((r) => [r.id, r]));

  const itemsOf = (customerId: string): DriverDayItem[] => {
    const out = new Map<string, DriverDayItem>();
    for (const o of input.orders) {
      if (o.customerId !== customerId || o.deliveryDate !== date) continue;
      if ((o.intent ?? "new") !== "new") continue;
      if (o.status !== "confirmed" && o.status !== "needs_review" && o.status !== "provisional") continue;
      for (const l of o.lines) {
        if (!l.productId || l.quantity <= 0) continue;
        const p = input.product(l.productId);
        const key = `${l.productId}|${o.status}`;
        const cur = out.get(key);
        if (cur) cur.quantity += l.quantity;
        else out.set(key, { productId: l.productId, name: p?.name ?? l.productId, unit: l.unit || p?.unit || "個", quantity: l.quantity, status: o.status });
      }
    }
    return [...out.values()];
  };
  const info = (c: CustomerMaster, no: number, isOff: boolean): DriverDayStop => {
    const r = row.get(c.id);
    const window = c.deliveryWindowFrom || c.deliveryWindowTo ? `${c.deliveryWindowFrom ?? ""}〜${c.deliveryWindowTo ?? ""}` : c.deliveryTime ? `${c.deliveryTime} ごろ` : undefined;
    return {
      id: c.id,
      name: c.name,
      no,
      off: isOff,
      ...(r && !r.noPosition && !isOff ? { arrive: toHHMM(r.start) } : {}),
      late: r && !isOff ? Math.round(r.late) : 0,
      ...(window ? { window } : {}),
      ...(c.address ? { address: c.address } : {}),
      ...(c.deliveryHowTo ? { howTo: c.deliveryHowTo } : {}),
      ...(c.deliveryCaution ? { caution: c.deliveryCaution } : {}),
      ...(c.closedWeekdays?.length ? { closedDays: c.closedWeekdays.map((d) => W[d]).join("・") } : {}),
      ...(c.fax ? { fax: c.fax } : {}),
      ...(c.lat != null && c.lng != null ? { lat: c.lat, lng: c.lng } : {}),
      items: isOff ? [] : itemsOf(c.id),
    };
  };
  return {
    courseId: course.id,
    courseName: course.name,
    depart: course.departTime,
    ...(on.some((c) => c.lat != null) ? { back: toHHMM(tl.back) } : {}),
    courseOff: !!course.weekdays?.length && !course.weekdays.includes(wd),
    ...(course.vehicle ? { vehicle: course.vehicle } : {}),
    stops: [...on.map((c, i) => info(c, i + 1, false)), ...off.map((c) => info(c, 0, true))],
  };
}
