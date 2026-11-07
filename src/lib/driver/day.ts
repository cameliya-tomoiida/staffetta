// 配送スタッフの画面（/driver）の「その日の配送」。純関数（保存も通信もしない）。
// - 回る順は ⑦ の便のマスタ（stops）。その日に届けない先（定休日・納品する曜日でない）は「お休み」として後ろに残す
// - 着く時刻の目安は ⑦ の buildTimeline（直線距離 × 係数 ÷ 速さ。道の上の時間は使わない＝スマホで速く出すため）
// - 各先に渡す商品と数は、その日の注文（確定・要確認・仮発注。変更・取消の連絡そのものは数えない）
import type { CourseMaster, CustomerMaster, CustomerProductMaster, Order } from "@/data/types";
import { deliversOn } from "@/lib/routes/optimize";
import { bestSlot, buildTimeline, orderedStops, serviceForPieces, toHHMM, type LatLng, type RouteSettings } from "@/lib/routes/plan";

import { deliveryRules, type DeliveryRule } from "./rules";
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
  /** その日だけ足した届け先（ふだんその曜日に来ない・注文がある） */
  added?: boolean;
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
  /** 納品の決まり（時間・検品・サイン・置き場所・注意）。着く前に大きく出す（⑧） */
  rules: DeliveryRule[];
  closedDays?: string;
  fax?: string;
  lat?: number;
  lng?: number;
  items: DriverDayItem[];
  /** いつもの商品（⑦の取引先の商品 customerProducts から。その曜日によく出るものを先に・8品まで） */
  usual: { name: string; unit?: string; weekdays: string; today: boolean }[];
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
  /** 取引先の商品（⑦）。無ければ「いつもの商品」は出さない */
  customerProducts?: CustomerProductMaster[];
}): DriverDay {
  const { course, date } = input;
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  // 納品にかかる時間: その日に届ける数で 5〜20分（⑧ 11/7。取引先に時間が入っていればそちら）
  const dayOrders = input.orders.filter((o) => o.deliveryDate === date && (o.intent ?? "new") === "new" && o.status !== "cancelled");
  const piecesOf = (id: string) => dayOrders.filter((o) => o.customerId === id).reduce((a, o) => a + o.lines.reduce((b, l) => b + (l.pieces || l.quantity), 0), 0);
  const all = orderedStops(course, input.customers).map((c) => ({ ...c, serviceMinutes: c.serviceMinutes ?? serviceForPieces(dayOrders.length ? piecesOf(c.id) : undefined) }));
  const on = all.filter((c) => deliversOn(c, wd));
  // ⑧ 11/7「基準のコースに、その日の追加の届け先を入れてコースができる」: ふだんその曜日に来ない先でも、その日に注文があれば、走る距離がいちばん増えない所に入れる
  const hasOrder = (id: string) => input.orders.some((o) => o.customerId === id && o.deliveryDate === date && (o.intent ?? "new") === "new" && o.status !== "cancelled");
  const extra = all.filter((c) => !deliversOn(c, wd) && hasOrder(c.id));
  for (const x of extra) {
    const located = on.filter((c) => c.lat != null && c.lng != null);
    if (x.lat == null || x.lng == null) on.push(x);
    else {
      const k = bestSlot(input.depot, located, x); // 位置のある先の中での場所 → on の中の場所へ
      on.splice(k < located.length ? on.indexOf(located[k]) : on.length, 0, x);
    }
  }
  const added = new Set(extra.map((x) => x.id));
  const off = all.filter((c) => !deliversOn(c, wd) && !added.has(c.id));
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
  const usualOf = (customerId: string) =>
    (input.customerProducts ?? [])
      .filter((p) => p.customerId === customerId && p.active !== false)
      .map((p) => ({ name: (p.productId && input.product(p.productId)?.name) || p.name, unit: p.unit || (p.productId ? input.product(p.productId)?.unit : undefined), weekdays: (p.weekdays ?? []).map((d) => W[d]).join("・"), today: !!p.weekdays?.includes(wd), q: p.quantity ?? 0 }))
      .sort((a, b) => Number(b.today) - Number(a.today) || b.q - a.q)
      .slice(0, 8)
      .map((u) => ({ name: u.name, unit: u.unit, weekdays: u.weekdays, today: u.today }));
  const info = (c: CustomerMaster, no: number, isOff: boolean): DriverDayStop => {
    const r = row.get(c.id);
    const window = c.deliveryWindowFrom || c.deliveryWindowTo ? `${c.deliveryWindowFrom ?? ""}〜${c.deliveryWindowTo ?? ""}` : c.deliveryTime ? `${c.deliveryTime} ごろ` : undefined;
    return {
      id: c.id,
      name: c.name,
      no,
      off: isOff,
      ...(added.has(c.id) ? { added: true } : {}),
      ...(r && !r.noPosition && !isOff ? { arrive: toHHMM(r.start) } : {}),
      late: r && !isOff ? Math.round(r.late) : 0,
      ...(window ? { window } : {}),
      ...(c.address ? { address: c.address } : {}),
      ...(c.deliveryHowTo ? { howTo: c.deliveryHowTo } : {}),
      ...(c.deliveryCaution ? { caution: c.deliveryCaution } : {}),
      rules: deliveryRules(c),
      ...(c.closedWeekdays?.length ? { closedDays: c.closedWeekdays.map((d) => W[d]).join("・") } : {}),
      ...(c.fax ? { fax: c.fax } : {}),
      ...(c.lat != null && c.lng != null ? { lat: c.lat, lng: c.lng } : {}),
      items: isOff ? [] : itemsOf(c.id),
      usual: usualOf(c.id),
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
