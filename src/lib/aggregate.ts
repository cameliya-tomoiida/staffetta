// 集計: 確定（confirmed）の注文だけを、納品日ごと・商品ごとに個数で合計する。
// 入口が FAX でも LINE でもインフォマートでも同じ Order なので、ここは入口を気にしない。
import type { Order, OrderLine } from "@/data/types";
import { findProduct, productOrder } from "./catalog";

export interface CustomerQty {
  customerId: string;
  pieces: number;
  /** どの注文から来た数か（元をたどる用） */
  orderIds: string[];
  /** 仕入の集計（purchaseTotalsForDate）だけ: 注文で指定された仕入先の便 */
  supplierDeliveryId?: string;
  /** 仕入の集計だけ: 前日に入れる注文のとき、お客さんへの納品日 */
  forDeliveryDate?: string;
}

export interface ProductTotal {
  productId: string;
  name: string;
  unit: string;
  pieces: number;
  customers: CustomerQty[];
}

export interface DayTotals {
  date: string; // YYYY-MM-DD（納品日）
  products: ProductTotal[];
  /** 集計で気になった点（商品が空・個数が合わない など） */
  warnings: string[];
}

export interface AggregateOptions {
  /** この納品日だけ */
  date?: string;
  /** この期間（両端を含む） */
  from?: string;
  to?: string;
}

/**
 * 1行の個数。型の決まり（pieces = quantity × piecesPerUnit）で計算し、
 * 保存されている pieces と食い違っていたら warning を返す。
 */
export function linePieces(line: OrderLine): { pieces: number; warning?: string } {
  const q = Number(line.quantity);
  const ppu = Number(line.piecesPerUnit);
  if (Number.isFinite(q) && Number.isFinite(ppu) && ppu > 0) {
    const pieces = q * ppu;
    if (Number.isFinite(line.pieces) && line.pieces !== pieces)
      return { pieces, warning: `個数が合いません（${q}${line.unit}×${ppu}=${pieces}、保存値 ${line.pieces}）` };
    return { pieces };
  }
  return { pieces: Number.isFinite(line.pieces) ? line.pieces : 0, warning: "数量か入数が空です" };
}

/**
 * 集計に数える注文か。
 * status が confirmed で、intent が new か未設定のものだけ。
 * - intent=change: 人が確定すると元の注文の数量が書き換わるので、数えると二重になる
 * - intent=cancel: 数えない
 * - provisional（仮発注）: 数えない（provisionalTotals で別枠に出す）
 */
export function countsInTotals(o: Order): boolean {
  return o.status === "confirmed" && (o.intent === undefined || o.intent === "new");
}

/** 仮発注として別枠に出す注文か（本発注に置き換わったもの＝cancelled や supersededBy ありは除く） */
export function countsAsProvisional(o: Order): boolean {
  return o.status === "provisional" && (o.intent === undefined || o.intent === "new") && !o.supersededBy;
}

/** 確定済み注文を納品日ごと・商品ごとに合計する（日付の昇順） */
export function aggregateOrders(orders: Order[], opts: AggregateOptions = {}): DayTotals[] {
  return aggregateBy(orders, countsInTotals, opts);
}

/**
 * 仮発注の合計（製造計画の画面で「仮：○個」と別枠に出す用）。
 * 確定の集計（aggregateOrders）には入らない。
 */
export function provisionalTotals(orders: Order[], opts: AggregateOptions = {}): DayTotals[] {
  return aggregateBy(orders, countsAsProvisional, opts);
}

/** 1日分の仮発注の合計 */
export function provisionalForDate(orders: Order[], date: string): DayTotals {
  return provisionalTotals(orders, { date })[0] ?? { date, products: [], warnings: [] };
}

function aggregateBy(orders: Order[], include: (o: Order) => boolean, opts: AggregateOptions): DayTotals[] {
  const days = new Map<string, { products: Map<string, ProductTotal>; warnings: string[] }>();
  for (const o of orders) {
    if (!include(o)) continue;
    const d = o.deliveryDate;
    if (opts.date && d !== opts.date) continue;
    if (opts.from && d < opts.from) continue;
    if (opts.to && d > opts.to) continue;
    const day = days.get(d) ?? { products: new Map<string, ProductTotal>(), warnings: [] as string[] };
    days.set(d, day);
    if (!o.customerId) day.warnings.push(`注文 ${o.id}: 得意先が空です`);
    for (const l of o.lines) {
      if (!l.productId) {
        day.warnings.push(`注文 ${o.id} 行 ${l.id}: 商品が空なので集計に入れていません`);
        continue;
      }
      const { pieces, warning } = linePieces(l);
      if (warning) day.warnings.push(`注文 ${o.id} 行 ${l.id}: ${warning}`);
      if (pieces === 0) continue;
      const p = findProduct(l.productId);
      if (!p) day.warnings.push(`注文 ${o.id}: 商品 ${l.productId} がマスターにありません`);
      const t = day.products.get(l.productId) ?? {
        productId: l.productId, name: p?.name ?? l.productId, unit: p?.unit ?? "個", pieces: 0, customers: [],
      };
      t.pieces += pieces;
      const c = t.customers.find((c) => c.customerId === o.customerId);
      if (c) {
        c.pieces += pieces;
        if (!c.orderIds.includes(o.id)) c.orderIds.push(o.id);
      } else t.customers.push({ customerId: o.customerId, pieces, orderIds: [o.id] });
      day.products.set(l.productId, t);
    }
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      products: [...d.products.values()].sort((a, b) => productOrder(a.productId) - productOrder(b.productId)),
      warnings: d.warnings,
    }));
}

/** 1日分の集計（注文が無ければ空） */
export function totalsForDate(orders: Order[], date: string): DayTotals {
  return aggregateOrders(orders, { date })[0] ?? { date, products: [], warnings: [] };
}

/** 集計に数える注文がある納品日の一覧 */
export function deliveryDatesOf(orders: Order[]): string[] {
  return [...new Set(orders.filter(countsInTotals).map((o) => o.deliveryDate))].sort();
}
