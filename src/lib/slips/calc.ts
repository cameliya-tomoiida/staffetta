// 伝票（納品書・受領書・請求書）と売上管理表の計算（作者 11/6 (37)）。純関数だけ（保存も印刷もしない）。
// 単価: 取引先ごとの卸価格（⑦の customerProducts）。無ければ商品の売価（円/個）
// 税: 商品ごとの税率（食品は軽減税率 8%、それ以外 10%。商品のマスタの taxRate、空なら 8）
// 端数: 適格請求書（インボイス）の決まりどおり、税率ごとに税抜の合計を出してから、消費税は1回だけ切り捨て
import type { CustomerMaster, CustomerProductMaster, Order, ProductMaster } from "@/data/types";

export type TaxRate = 8 | 10;

export interface SlipLine {
  productId: string;
  /** 伝票に出す品名（取引先の商品名があればそれ） */
  name: string;
  quantity: number;
  unit: string;
  /** 単価（税抜・円/単位） */
  unitPrice: number;
  /** 金額（税抜・円。単価 × 数量を円未満四捨五入） */
  amount: number;
  taxRate: TaxRate;
  /** 単価をどこから取ったか */
  priceFrom: "卸価格" | "売価";
  /** 原価（税抜・円。わかるときだけ） */
  cost?: number;
  /** 商品コード（取引先の商品のコード＝弥生販売の商品コード。無ければ商品ID） */
  code?: string;
}

export interface TaxTotals {
  /** net＝税抜（割戻しがあれば割戻しを引いたあと）。rebate＝その税率の割戻しの額 */
  byRate: { rate: TaxRate; net: number; tax: number; rebate?: number }[];
  /** 税抜の合計 */
  net: number;
  tax: number;
  /** 税込の合計 */
  total: number;
}

export interface DeliverySlip {
  /** 伝票番号（D-日付-取引先） */
  no: string;
  date: string;
  customerId: string;
  customerName: string;
  course?: string;
  /** 取引先の伝票の様式（formats.ts） */
  format?: string;
  lines: SlipLine[];
  totals: TaxTotals;
  /** 注文の番号（元の注文） */
  orderIds: string[];
}

export interface PriceBook {
  products: Pick<ProductMaster, "id" | "name" | "unit" | "price" | "unitCost" | "kind" | "taxRate">[];
  customerProducts: (Pick<CustomerProductMaster, "customerId" | "productId" | "name" | "unit" | "price" | "cost" | "active"> & { code?: string })[];
  /** 商品の原価（円/個。自社製造は材料費など）。わからなければ undefined */
  costOf?: (productId: string) => number | undefined;
}

const yen = (x: number) => Math.round(x);
export const rateOf = (p: { taxRate?: number } | undefined): TaxRate => (p?.taxRate === 10 ? 10 : 8);

/** 1行の値段（取引先の卸価格 → 商品の売価） */
export function priceLine(line: Pick<Order["lines"][number], "productId" | "quantity" | "unit" | "piecesPerUnit" | "pieces">, customerId: string, book: PriceBook): SlipLine {
  const p = book.products.find((x) => x.id === line.productId);
  const cp = book.customerProducts.find((x) => x.customerId === customerId && x.productId === line.productId && x.active !== false && x.price != null);
  const taxRate = rateOf(p);
  const name = cp?.name || p?.name || line.productId;
  const per = line.piecesPerUnit > 0 ? line.piecesPerUnit : 1;
  const pieceCost = book.costOf?.(line.productId) ?? (p?.kind === "buy" ? p.unitCost : undefined);
  // 取引先の単位と注文の単位が同じ（または取引先の単位が空）→ そのまま。取引先の単位が「個」→ 個数で。ほかは売価で
  if (cp && (!cp.unit || cp.unit === line.unit)) {
    const amount = yen(cp.price! * line.quantity);
    const cost = cp.cost != null ? yen(cp.cost * line.quantity) : pieceCost != null ? yen(pieceCost * line.pieces) : undefined;
    return { productId: line.productId, name, quantity: line.quantity, unit: line.unit, unitPrice: cp.price!, amount, taxRate, priceFrom: "卸価格", code: cp.code || line.productId, ...(cost != null ? { cost } : {}) };
  }
  if (cp && cp.unit === "個") {
    const amount = yen(cp.price! * line.pieces);
    const cost = cp.cost != null ? yen(cp.cost * line.pieces) : pieceCost != null ? yen(pieceCost * line.pieces) : undefined;
    return { productId: line.productId, name, quantity: line.pieces, unit: "個", unitPrice: cp.price!, amount, taxRate, priceFrom: "卸価格", code: cp.code || line.productId, ...(cost != null ? { cost } : {}) };
  }
  const unitPrice = Math.round((p?.price ?? 0) * per * 100) / 100;
  const cost = pieceCost != null ? yen(pieceCost * line.pieces) : undefined;
  return { productId: line.productId, name: p?.name ?? line.productId, quantity: line.quantity, unit: line.unit, unitPrice, amount: yen((p?.price ?? 0) * line.pieces), taxRate, priceFrom: "売価", code: book.customerProducts.find((x) => x.customerId === customerId && x.productId === line.productId)?.code || line.productId, ...(cost != null ? { cost } : {}) };
}

/** 税率ごとに合計してから、消費税を1回だけ切り捨て（インボイスの決まり） */
export function taxTotals(lines: Pick<SlipLine, "amount" | "taxRate">[]): TaxTotals {
  const by = new Map<TaxRate, number>();
  for (const l of lines) by.set(l.taxRate, (by.get(l.taxRate) ?? 0) + l.amount);
  const byRate = ([8, 10] as TaxRate[]).filter((r) => by.has(r)).map((rate) => {
    const net = by.get(rate)!;
    return { rate, net, tax: Math.floor((net * rate) / 100) };
  });
  const net = byRate.reduce((s, x) => s + x.net, 0);
  const tax = byRate.reduce((s, x) => s + x.tax, 0);
  return { byRate, net, tax, total: net + tax };
}

/**
 * 割戻しのある請求（給食会社など。請求金額 → 割戻し ◯% を引く → 消費税 → 差引請求額）。
 * 税率ごとに税抜の合計から割戻しを引き（円未満切り捨て）、引いたあとの額に消費税を1回だけ（切り捨て）
 */
export function taxTotalsWithRebate(lines: Pick<SlipLine, "amount" | "taxRate">[], rebatePercent: number): TaxTotals & { gross: number; rebate: number } {
  const base = taxTotals(lines);
  const p = Math.max(0, Math.min(100, rebatePercent));
  const byRate = base.byRate.map((r) => {
    const rebate = Math.floor((r.net * p) / 100);
    const net = r.net - rebate;
    return { rate: r.rate, net, rebate, tax: Math.floor((net * r.rate) / 100) };
  });
  const net = byRate.reduce((s, x) => s + x.net, 0);
  const tax = byRate.reduce((s, x) => s + x.tax, 0);
  return { byRate, net, tax, total: net + tax, gross: base.net, rebate: byRate.reduce((s, x) => s + (x.rebate ?? 0), 0) };
}

/** 伝票にする注文: 確定した・新しい注文（変更・取消の FAX は、人が確定したら元の注文に入っている） */
export const billable = (o: Order) => o.status === "confirmed" && (o.intent ?? "new") === "new" && !!o.customerId;

/** その日の納品書（取引先ごとに1枚。同じ商品・単位の行はまとめる） */
export function deliverySlips(orders: Order[], date: string, customers: Pick<CustomerMaster, "id" | "name" | "course" | "slipFormat">[], book: PriceBook): DeliverySlip[] {
  const by = new Map<string, Order[]>();
  for (const o of orders) if (billable(o) && o.deliveryDate === date) by.set(o.customerId, [...(by.get(o.customerId) ?? []), o]);
  return [...by.entries()].map(([customerId, os]) => {
    const merged = new Map<string, Order["lines"][number]>();
    for (const l of os.flatMap((o) => o.lines)) {
      if (!l.productId || l.quantity <= 0) continue;
      const k = `${l.productId}|${l.unit}|${l.piecesPerUnit}`;
      const cur = merged.get(k);
      merged.set(k, cur ? { ...cur, quantity: cur.quantity + l.quantity, pieces: cur.pieces + l.pieces } : l);
    }
    const lines = [...merged.values()].map((l) => priceLine(l, customerId, book));
    const c = customers.find((x) => x.id === customerId);
    return {
      no: `D${date.replace(/-/g, "").slice(2)}-${customerId}`,
      date, customerId, customerName: c?.name ?? customerId, ...(c?.course ? { course: c.course } : {}), ...(c?.slipFormat ? { format: c.slipFormat } : {}),
      lines, totals: taxTotals(lines), orderIds: os.map((o) => o.id),
    };
  });
}

// ───────── 締め日と請求の期間 ─────────

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

/** その月の締めの日（締め日が空・0・月の日数より大きい → 月末） */
export function closingDate(month: string, closingDay?: number): string {
  const [y, m] = month.split("-").map(Number);
  const n = daysIn(y, m);
  const d = !closingDay || closingDay >= n ? n : closingDay;
  return iso(y, m, d);
}

/** 締めの日で終わる請求の期間（前の締めの次の日から） */
export function billingPeriod(month: string, closingDay?: number): { from: string; to: string } {
  const to = closingDate(month, closingDay);
  const [y, m] = month.split("-").map(Number);
  const prevMonth = iso(y, m - 1, 1).slice(0, 7);
  const prev = closingDate(prevMonth, closingDay);
  const [py, pm, pd] = prev.split("-").map(Number);
  return { from: iso(py, pm, pd + 1), to };
}

/** 締め日の表し方（"月末"・"20日"） */
export const closingLabel = (d?: number) => (!d || d >= 28 ? "月末" : `${d}日`);

export interface Invoice {
  /** 請求書の番号（I-年月-締め-取引先） */
  no: string;
  customerId: string;
  customerName: string;
  closingDay?: number;
  period: { from: string; to: string };
  /** 納品ごと（日付・伝票番号・行・税抜の合計） */
  deliveries: { date: string; no: string; lines: SlipLine[]; net: number; place?: string }[];
  totals: TaxTotals;
  /** 割戻し（取引先の設定 rebateRate。税抜の合計・割戻しの率と額） */
  rebate?: { percent: number; gross: number; amount: number };
  /** 事業所（納品場所）ごとの小計（取引先の設定 invoiceByPlace） */
  places?: { place: string; net: number }[];
}

/** 締めの月 month の請求書（取引先ごと。期間の納品をまとめる。前回の請求・入金・繰り越しは扱わない＝今回の分だけ） */
export function invoices(orders: Order[], month: string, customers: Pick<CustomerMaster, "id" | "name" | "course" | "closingDay" | "rebateRate" | "invoiceByPlace">[], book: PriceBook, opts: { closingDay?: number; customerId?: string } = {}): Invoice[] {
  const out: Invoice[] = [];
  for (const c of customers) {
    if (opts.customerId && c.id !== opts.customerId) continue;
    if (opts.closingDay != null && closingDate(month, c.closingDay) !== closingDate(month, opts.closingDay)) continue;
    const period = billingPeriod(month, c.closingDay);
    const dates = [...new Set(orders.filter((o) => billable(o) && o.customerId === c.id && o.deliveryDate >= period.from && o.deliveryDate <= period.to).map((o) => o.deliveryDate))].sort();
    if (!dates.length) continue;
    const mine = orders.filter((o) => o.customerId === c.id);
    // 事業所（納品場所）ごとに分ける取引先は、日 × 事業所で1つの納品
    const deliveries = dates.flatMap((d): Invoice["deliveries"] => {
      if (!c.invoiceByPlace) return deliverySlips(mine, d, [c], book).map((s) => ({ date: s.date, no: s.no, lines: s.lines, net: s.totals.net }));
      const places = [...new Set(mine.filter((o) => billable(o) && o.deliveryDate === d).map((o) => o.deliveryPlace?.trim() || "（事業所なし）"))].sort();
      return places.flatMap((place, pi) =>
        deliverySlips(mine.filter((o) => (o.deliveryPlace?.trim() || "（事業所なし）") === place), d, [c], book).map((s) => ({ date: s.date, no: `${s.no}-${pi + 1}`, lines: s.lines, net: s.totals.net, place })),
      );
    });
    const all = deliveries.flatMap((d) => d.lines);
    const rate = c.rebateRate && c.rebateRate > 0 ? c.rebateRate : 0;
    const rb = rate ? taxTotalsWithRebate(all, rate) : undefined;
    const t = rb ?? taxTotals(all);
    const placeNets = c.invoiceByPlace ? [...new Set(deliveries.map((d) => d.place ?? ""))].map((place) => ({ place, net: deliveries.filter((d) => d.place === place).reduce((s, d) => s + d.net, 0) })) : undefined;
    out.push({
      no: `I${period.to.replace(/-/g, "").slice(2)}-${c.id}`,
      customerId: c.id, customerName: c.name, ...(c.closingDay ? { closingDay: c.closingDay } : {}), period, deliveries,
      totals: { byRate: t.byRate, net: t.net, tax: t.tax, total: t.total },
      ...(rb ? { rebate: { percent: rate, gross: rb.gross, amount: rb.rebate } } : {}),
      ...(placeNets ? { places: placeNets } : {}),
    });
  }
  return out;
}

// ───────── 売上管理表 ─────────

export interface SalesRow {
  key: string;
  name: string;
  quantity: number;
  /** 税抜の売上 */
  sales: number;
  /** 原価（わかる行だけの合計） */
  cost: number;
  /** 原価がわかる行の売上（粗利率の分母） */
  costedSales: number;
  gross: number;
  /** 前の月・前の年の同じ月の売上 */
  prevMonth?: number;
  prevYear?: number;
}

export type SalesBy = "customer" | "product" | "course" | "day";

/** その期間の売上の行（取引先・商品・コース・日ごと） */
export function salesRows(orders: Order[], from: string, to: string, by: SalesBy, customers: Pick<CustomerMaster, "id" | "name" | "course">[], book: PriceBook): SalesRow[] {
  const rows = new Map<string, SalesRow>();
  for (const o of orders) {
    if (!billable(o) || o.deliveryDate < from || o.deliveryDate > to) continue;
    const c = customers.find((x) => x.id === o.customerId);
    for (const l of o.lines) {
      if (!l.productId || l.quantity <= 0) continue;
      const s = priceLine(l, o.customerId, book);
      const key = by === "customer" ? o.customerId : by === "product" ? l.productId : by === "course" ? c?.course || "（コースなし）" : o.deliveryDate;
      const name = by === "customer" ? c?.name ?? o.customerId : by === "product" ? book.products.find((p) => p.id === l.productId)?.name ?? l.productId : key;
      const r = rows.get(key) ?? { key, name, quantity: 0, sales: 0, cost: 0, costedSales: 0, gross: 0 };
      r.quantity += by === "product" ? l.pieces : 0;
      r.sales += s.amount;
      if (s.cost != null) {
        r.cost += s.cost;
        r.costedSales += s.amount;
      }
      r.gross = r.costedSales - r.cost;
      rows.set(key, r);
    }
  }
  return [...rows.values()].sort((a, b) => b.sales - a.sales);
}

/** 月の売上管理表（前の月・前の年の同じ月との比べつき） */
export function salesTable(orders: Order[], month: string, by: SalesBy, customers: Pick<CustomerMaster, "id" | "name" | "course">[], book: PriceBook): SalesRow[] {
  const [y, m] = month.split("-").map(Number);
  const range = (mm: string) => [`${mm}-01`, closingDate(mm)] as const;
  const pm = iso(y, m - 1, 1).slice(0, 7);
  const py = `${y - 1}-${String(m).padStart(2, "0")}`;
  const cur = salesRows(orders, ...range(month), by, customers, book);
  if (by === "day") return cur.sort((a, b) => a.key.localeCompare(b.key));
  const prev = new Map(salesRows(orders, ...range(pm), by, customers, book).map((r) => [r.key, r.sales]));
  const last = new Map(salesRows(orders, ...range(py), by, customers, book).map((r) => [r.key, r.sales]));
  return cur.map((r) => ({ ...r, prevMonth: prev.get(r.key) ?? 0, prevYear: last.get(r.key) ?? 0 }));
}

/** CSV（Excel で開けるように BOM つき・カンマ区切り・"" でくくる） */
export function toCsv(head: string[], rows: (string | number | undefined)[][]): string {
  const q = (v: string | number | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return "﻿" + [head, ...rows].map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";
}

// ───────── 弥生販売への取り込み（(D) 事務の人「弥生に毎回、商品ごとの数を入れ直している」）─────────

/** 弥生販売の売上伝票の取り込み用の列（見本の形。項目と順は、弥生の「汎用データ受入」の画面で確かめて合わせる） */
export const YAYOI_HEAD = ["伝票日付", "伝票番号", "得意先コード", "得意先名", "行", "商品コード", "商品名", "数量", "単位", "単価", "金額", "税率", "備考"];

/** 納品書（確定した売上）→ 弥生の売上伝票の行（1明細＝1行。同じ伝票番号の行が1枚の伝票） */
export function yayoiRows(slips: DeliverySlip[], customerCode: (customerId: string) => string = (id) => id): (string | number)[][] {
  return slips.flatMap((s) =>
    s.lines.map((l, i) => [
      s.date.replace(/-/g, "/"), s.no, customerCode(s.customerId), s.customerName, i + 1, l.code ?? l.productId, l.name, l.quantity, l.unit, l.unitPrice, l.amount, `${l.taxRate}%${l.taxRate === 8 ? "（軽減）" : ""}`, l.priceFrom === "売価" ? "単価は商品の売価" : "",
    ]),
  );
}
