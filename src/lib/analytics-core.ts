// 動くグラフの分析画面（⑧ 近未来 ③）の集計の中身（注文とマスタを渡す。画面のしくみを読まないので、測る・テストから使える）。注文（保存した注文＋見本の注文）× 商品ごとの売値・原価（cost.ts）。
// 日ごとの売上・粗利／取引先ごと／商品ごと／曜日ごと／注文の入口の割合／ロス（製品カードに書いた分）
import type { Masters, Order } from "@/data/types";
import { linePieces } from "@/lib/aggregate";
import { withMasters } from "@/lib/catalog";
import { productCost } from "@/lib/cost";
import { getDb } from "@/lib/db/sqlite";
import { channelLabel } from "@/components/ui/tokens";

export interface Money {
  sales: number;
  gross: number;
  pieces: number;
  orders: number;
}
export interface Named extends Money {
  id: string;
  name: string;
  grossRate: number;
}
export interface Analytics {
  today: string;
  total: Money & { grossRate: number; customers: number };
  days: (Money & { date: string })[];
  customers: Named[];
  products: Named[];
  weekdays: (Money & { wd: number })[];
  channels: { id: string; name: string; orders: number }[];
  losses: { id: string; name: string; pieces: number; rate: number }[];
}

const empty = (): Money => ({ sales: 0, gross: 0, pieces: 0, orders: 0 });
const add = (m: Money, x: Money) => ((m.sales += x.sales), (m.gross += x.gross), (m.pieces += x.pieces), (m.orders += x.orders), m);
const rate = (m: Money) => (m.sales > 0 ? Math.round((m.gross / m.sales) * 1000) / 10 : 0);

/** 1件の注文の金額（商品の売値・原価） */
function orderMoney(o: Order, cost: (pid: string) => { price: number; cost: number; name: string }): { m: Money; byProduct: Map<string, Money> } {
  const m = { ...empty(), orders: 1 };
  const byProduct = new Map<string, Money>();
  for (const l of o.lines ?? []) {
    if (!l.productId) continue;
    const { pieces } = linePieces(l);
    if (!pieces) continue;
    const c = cost(l.productId);
    const x = { sales: c.price * pieces, gross: (c.price - c.cost) * pieces, pieces, orders: 0 };
    add(m, x);
    byProduct.set(l.productId, add(byProduct.get(l.productId) ?? empty(), x));
  }
  return { m, byProduct };
}

/** 集計の中身（注文とマスタを渡す。測るとき・テストから使う） */
export function analyticsFrom(orders: Order[], masters: Masters, today: string): Analytics {
  const costs = new Map<string, { price: number; cost: number; name: string }>();
  const cost = (pid: string) => {
    let c = costs.get(pid);
    if (!c) {
      const pc = withMasters(masters, () => productCost(pid));
      c = { price: pc.price || 0, cost: pc.cost || 0, name: pc.name || pid };
      costs.set(pid, c);
    }
    return c;
  };
  const custName = new Map((masters.customers ?? []).map((c) => [c.id, c.name]));
  const live = orders.filter((o) => o.status !== "cancelled");
  const total = empty();
  const days = new Map<string, Money>();
  const cust = new Map<string, Money>();
  const prod = new Map<string, Money>();
  const wds = Array.from({ length: 7 }, empty);
  const ch = new Map<string, number>();
  for (const o of live) {
    const { m, byProduct } = orderMoney(o, cost);
    add(total, m);
    add(days.get(o.deliveryDate) ?? days.set(o.deliveryDate, empty()).get(o.deliveryDate)!, m);
    if (o.customerId) add(cust.get(o.customerId) ?? cust.set(o.customerId, empty()).get(o.customerId)!, m);
    for (const [pid, x] of byProduct) add(prod.get(pid) ?? prod.set(pid, empty()).get(pid)!, { ...x, orders: 1 });
    add(wds[new Date(`${o.deliveryDate}T00:00:00Z`).getUTCDay()], m);
    ch.set(o.source.channel, (ch.get(o.source.channel) ?? 0) + 1);
  }
  const named = (map: Map<string, Money>, nameOf: (id: string) => string) =>
    [...map.entries()].map(([id, m]) => ({ id, name: nameOf(id), ...m, grossRate: rate(m) })).sort((a, b) => b.sales - a.sales);
  return {
    today,
    total: { ...total, grossRate: rate(total), customers: cust.size },
    days: [...days.entries()].map(([date, m]) => ({ date, ...m })).sort((a, b) => a.date.localeCompare(b.date)).slice(-21),
    customers: named(cust, (id) => custName.get(id) ?? id).slice(0, 10),
    products: named(prod, (id) => cost(id).name).slice(0, 10),
    weekdays: wds.map((m, wd) => ({ wd, ...m })),
    channels: [...ch.entries()].map(([id, n]) => ({ id, name: channelLabel[id as keyof typeof channelLabel]?.short ?? id, orders: n })).sort((a, b) => b.orders - a.orders),
    losses: cardLosses(cost),
  };
}

/** 製品カードに書いたロス（工程ごとのロスの合計）と、作った数に対する割合 */
function cardLosses(cost: (pid: string) => { name: string }): Analytics["losses"] {
  let rows: { json: string }[] = [];
  try {
    rows = getDb().prepare("SELECT json FROM product_cards").all() as { json: string }[];
  } catch {
    return [];
  }
  const sum = new Map<string, { loss: number; made: number }>();
  for (const r of rows) {
    let input: { items?: Record<string, { made?: number; loss?: number; losses?: Record<string, number> }> };
    try {
      input = JSON.parse(r.json);
    } catch {
      continue;
    }
    for (const [pid, x] of Object.entries(input.items ?? {})) {
      const loss = Object.values(x.losses ?? {}).reduce((a, b) => a + (Number(b) || 0), 0) || Number(x.loss) || 0;
      const s = sum.get(pid) ?? { loss: 0, made: 0 };
      s.loss += loss;
      s.made += Number(x.made) || 0;
      sum.set(pid, s);
    }
  }
  return [...sum.entries()]
    .filter(([, s]) => s.loss > 0)
    .map(([id, s]) => ({ id, name: cost(id).name, pieces: s.loss, rate: s.made > 0 ? Math.round((s.loss / s.made) * 1000) / 10 : 0 }))
    .sort((a, b) => b.pieces - a.pieces)
    .slice(0, 8);
}
