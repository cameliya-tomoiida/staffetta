import "server-only";
// 伝票と売上管理表の読み出し（作者 11/6 (37)）。計算は src/lib/slips/calc.ts（純関数）。
// 注文は保存してある注文＋見本の注文（受注一覧と同じ）。マスタ（取引先・商品・卸価格・コース）は loadMasters。
import type { Order } from "@/data/types";
import { demoOrders } from "@/demo/orders";
import { withMasters } from "@/lib/catalog";
import { productCost } from "@/lib/cost";
import { loadRecentDb } from "@/lib/db/hub-store";
import { loadMasters } from "@/lib/masters/seed-db";
import { billingPeriod, closingDate, deliverySlips, invoices, salesTable, type DeliverySlip, type Invoice, type PriceBook, type SalesBy, type SalesRow } from "./calc";

type Masters = Awaited<ReturnType<typeof loadMasters>>;

async function ordersSince(since: string): Promise<Order[]> {
  const db = await loadRecentDb({ since });
  const ids = new Set(db.orders.map((o) => o.id));
  return [...db.orders, ...demoOrders().filter((o) => !ids.has(o.id))];
}

function bookOf(m: Masters): PriceBook {
  return {
    products: m.products,
    customerProducts: m.customerProducts ?? [],
    costOf: (id) => withMasters(m, () => {
      const c = productCost(id);
      return c.kind === "unknown" || !(c.cost > 0) ? undefined : c.cost;
    }),
  };
}

/** コースの並び（便のマスタの順・その中は回る順） */
function courseOrder(m: Masters) {
  const courses = (m.courses ?? []).filter((c) => c.active !== false);
  const ci = new Map(courses.map((c, i) => [c.id, i]));
  const stop = new Map<string, number>();
  for (const c of courses) (c.stops ?? []).forEach((id, i) => stop.set(`${c.id}|${id}`, i));
  return (a: DeliverySlip, b: DeliverySlip) =>
    (ci.get(a.course ?? "") ?? 999) - (ci.get(b.course ?? "") ?? 999) ||
    (a.course ?? "").localeCompare(b.course ?? "") ||
    (stop.get(`${a.course}|${a.customerId}`) ?? 999) - (stop.get(`${b.course}|${b.customerId}`) ?? 999) ||
    a.customerId.localeCompare(b.customerId);
}

export interface DayView {
  date: string;
  slips: DeliverySlip[];
  /** コースの一覧（その日に納品があるもの） */
  courses: string[];
}

/** その日の納品書（コース・取引先で絞れる）。コースの順・回る順に並べる */
export async function deliveryDay(date: string, opts: { course?: string; customerId?: string } = {}): Promise<DayView> {
  const [orders, m] = await Promise.all([ordersSince(date), loadMasters()]);
  const all = deliverySlips(orders, date, m.customers, bookOf(m)).sort(courseOrder(m));
  const courses = [...new Set(all.map((s) => s.course ?? "（コースなし）"))];
  const slips = all.filter((s) => (!opts.course || (s.course ?? "（コースなし）") === opts.course) && (!opts.customerId || s.customerId === opts.customerId));
  return { date, slips, courses };
}

/** 締めの月の請求書（締め日・取引先で絞れる） */
export async function invoicesOf(month: string, opts: { closingDay?: number; customerId?: string } = {}): Promise<Invoice[]> {
  const m = await loadMasters();
  // いちばん早い期間の始まり（締め日 1 日の取引先なら、前の月の 2 日から）
  const since = billingPeriod(month, 1).from;
  const orders = await ordersSince(since);
  return invoices(orders, month, m.customers, bookOf(m), opts);
}

/** その月の締め日の一覧（取引先の締め日。請求書の画面の選びに使う） */
export async function closingDaysOf(month: string): Promise<{ day: number; date: string; customers: number }[]> {
  const m = await loadMasters();
  const by = new Map<string, { day: number; date: string; customers: number }>();
  for (const c of m.customers.filter((x) => x.active !== false)) {
    const date = closingDate(month, c.closingDay);
    const cur = by.get(date) ?? { day: c.closingDay && c.closingDay < 28 ? c.closingDay : 31, date, customers: 0 };
    cur.customers++;
    by.set(date, cur);
  }
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** 月の売上管理表（前の年の同じ月まで読む） */
export async function salesOf(month: string, by: SalesBy): Promise<SalesRow[]> {
  const m = await loadMasters();
  const [y, mm] = month.split("-").map(Number);
  const orders = await ordersSince(`${y - 1}-${String(mm).padStart(2, "0")}-01`);
  return salesTable(orders, month, by, m.customers, bookOf(m));
}

/** 期間の納品書（弥生販売への取り込み用。納品日・コースの順） */
export async function slipsBetween(from: string, to: string): Promise<DeliverySlip[]> {
  const [orders, m] = await Promise.all([ordersSince(from), loadMasters()]);
  const dates = [...new Set(orders.filter((o) => o.deliveryDate >= from && o.deliveryDate <= to).map((o) => o.deliveryDate))].sort();
  const book = bookOf(m);
  const order = courseOrder(m);
  return dates.flatMap((d) => deliverySlips(orders, d, m.customers, book).sort(order));
}

/** 月の日ごとの売上（⑧ 日ごとの実績のカレンダー）。確定した注文の納品書の税抜の合計と、納品した取引先の数 */
export async function monthSales(month: string): Promise<Map<string, { net: number; customers: number }>> {
  const [orders, m] = await Promise.all([ordersSince(`${month}-01`), loadMasters()]);
  const book = bookOf(m);
  const out = new Map<string, { net: number; customers: number }>();
  const dates = [...new Set(orders.filter((o) => o.deliveryDate.startsWith(month)).map((o) => o.deliveryDate))];
  for (const d of dates) {
    const slips = deliverySlips(orders, d, m.customers, book);
    if (slips.length) out.set(d, { net: slips.reduce((a, s) => a + s.totals.net, 0), customers: slips.length });
  }
  return out;
}
