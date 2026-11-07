// 日ごとの実績（⑧・担当者 11/7）。月のカレンダーで日を選ぶ → その日の中身。
//   営業・配送: 全体の売上・コースごとの売上 → コースを開くと回る順に 取引先 → 商品・数・単価・金額 → 小計（納品書と同じ値段）
//   製造: 作った数・売上の合計 → 生地ごとに 商品・作った数・出来上がった時刻（製品カードに書いた時刻、無ければ予定）・売上・どの取引先用か
import "server-only";
import { allOrders } from "@/demo/all-orders";
import { loadMasters } from "@/lib/masters/seed-db";
import { runPipeline } from "@/lib/pipeline";
import { withMasters } from "@/lib/catalog";
import { productCost } from "@/lib/cost";
import { getDb } from "@/lib/db/sqlite";
import { deliveryDay } from "@/lib/slips/store";
import { liveCustomers } from "@/lib/customers-live";
import { getProductionActual } from "@/lib/stock/store";

export interface SalesCourse {
  id: string; name: string; net: number;
  customers: { id: string; name: string; net: number; lines: { name: string; quantity: number; unit: string; unitPrice: number; amount: number }[] }[];
}
export interface MakeDough {
  key: string; name: string; pieces: number; sales: number; done?: string; doneBy: "実績" | "予定" | "";
  items: { name: string; pieces: number; sales: number; customers: string[]; /** 予定の数（実績と違うときだけ） */ plan?: number }[];
}
export interface DayDetail { date: string; sales: { net: number; courses: SalesCourse[] }; make: { pieces: number; sales: number; doughs: MakeDough[]; /** 製造の実績（作った数）を記録した時刻と人。無ければ予定の数 */ recorded?: { at: string; who: string } } }

const hhmm = (m: number) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;

export async function dayDetail(date: string): Promise<DayDetail> {
  const [{ slips }, masters, { orders }, live] = await Promise.all([deliveryDay(date), loadMasters(), allOrders(), liveCustomers({ all: true }).catch(() => [])]);
  const courseName = new Map((masters.courses ?? []).map((c) => [c.id, c.name]));
  const custName = new Map([...(masters.customers ?? []), ...live].map((c) => [c.id, c.name]));

  // 売上: 納品書（コースの順・回る順に並んでいる）をコースごとに
  const courses: SalesCourse[] = [];
  for (const s of slips) {
    const id = s.course ?? "";
    let c = courses.find((x) => x.id === id);
    if (!c) courses.push((c = { id, name: id ? courseName.get(id) ?? id : "コースなし", net: 0, customers: [] }));
    c.net += s.totals.net;
    c.customers.push({ id: s.customerId, name: s.customerName, net: s.totals.net, lines: s.lines.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, amount: l.amount })) });
  }

  // 製造: その日の計画（生地ごと）と、製品カードに書いた時刻
  const r = runPipeline(orders, date, { masters });
  const cards = new Map<string, { steps?: Record<string, { end?: string }> }>();
  try {
    for (const x of getDb().prepare("SELECT dough_key, json FROM product_cards WHERE date = ?").all(date) as { dough_key: string; json: string }[]) cards.set(x.dough_key, JSON.parse(x.json));
  } catch { /* 表が無ければ予定だけ */ }
  const price = (pid: string) => withMasters(masters, () => productCost(pid).price || 0);
  // 作った数: 製造の実績（⑤ 作り終えたら記録）があればその数。同じ商品が何生地かに分かれていたら、予定の割合で分ける
  const actual = await getProductionActual(date).catch(() => undefined);
  const madeOf = new Map((actual?.made ?? []).map((m) => [m.productId, m.pieces]));
  const planTotal = new Map<string, number>();
  for (const d of r.production.doughs) for (const it of d.items) planTotal.set(it.productId, (planTotal.get(it.productId) ?? 0) + it.pieces);
  const madeFor = (pid: string, planned: number) => {
    if (!actual) return planned;
    const all = madeOf.get(pid) ?? 0;
    const tot = planTotal.get(pid) ?? planned;
    return tot > 0 ? Math.round((all * planned) / tot) : 0;
  };
  const doughs = r.production.doughs.map((d): MakeDough => {
    const sch = r.schedule.find((x) => x.key === d.key);
    const planEnd = sch?.steps.length ? Math.max(...sch.steps.filter((s) => !s.prevDay).map((s) => s.end)) : undefined;
    const ends = Object.values(cards.get(d.key)?.steps ?? {}).map((s) => s.end).filter((x): x is string => !!x && /^\d{1,2}:\d{2}$/.test(x)).sort((a, b) => a.padStart(5, "0").localeCompare(b.padStart(5, "0")));
    const items = d.items.map((it) => ({
      name: it.name, pieces: madeFor(it.productId, it.pieces), ...(actual && madeFor(it.productId, it.pieces) !== it.pieces ? { plan: it.pieces } : {}),
      sales: Math.round(price(it.productId) * (it.ordered ?? it.pieces)),
      customers: [...new Set((it.customerPieces ?? []).map((c) => custName.get(c.customerId) ?? c.customerId))],
    }));
    return {
      key: d.key, name: d.waveName ? `${d.name}（${d.waveName}）` : d.name, pieces: items.reduce((a, x) => a + x.pieces, 0), sales: items.reduce((a, x) => a + x.sales, 0),
      done: ends.at(-1) ?? (planEnd != null && Number.isFinite(planEnd) ? hhmm(planEnd) : undefined), doneBy: ends.length ? "実績" : planEnd != null ? "予定" : "",
      items,
    };
  }).sort((a, b) => (a.done ?? "99").padStart(5, "0").localeCompare((b.done ?? "99").padStart(5, "0")));
  return {
    date,
    sales: { net: courses.reduce((a, c) => a + c.net, 0), courses },
    make: { pieces: doughs.reduce((a, d) => a + d.pieces, 0), sales: doughs.reduce((a, d) => a + d.sales, 0), doughs, ...(actual ? { recorded: { at: actual.at, who: actual.who } } : {}) },
  };
}
