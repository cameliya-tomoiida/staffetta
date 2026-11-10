// 取引先の商品と卸価格（⑦）の集計。純関数。
//   粗利 = 卸価格 − 原価（1単位）。期間の売上 = 数量 × 卸価格、期間の粗利 = 数量 × 粗利。
import type { CustomerProductMaster } from "@/data/types";

export interface CustomerProductRow extends CustomerProductMaster {
  id: string;
  /** 1単位の粗利（円）と粗利率（0〜1）。卸価格か原価が無ければ undefined */
  margin?: number;
  marginRate?: number;
  /** 期間の売上・粗利（円） */
  sales?: number;
  profit?: number;
}

export function withMargin(r: CustomerProductMaster & { id: string }): CustomerProductRow {
  const margin = r.price != null && r.cost != null ? Math.round((r.price - r.cost) * 100) / 100 : undefined;
  const marginRate = margin != null && r.price ? margin / r.price : undefined;
  const sales = r.price != null && r.quantity != null ? Math.round(r.price * r.quantity) : undefined;
  const profit = margin != null && r.quantity != null ? Math.round(margin * r.quantity) : undefined;
  return { ...r, ...(margin != null ? { margin } : {}), ...(marginRate != null ? { marginRate } : {}), ...(sales != null ? { sales } : {}), ...(profit != null ? { profit } : {}) };
}

export interface CustomerSummary {
  customerId: string;
  items: number;
  sales: number;
  profit: number;
  /** 粗利がマイナスの商品の数 */
  negative: number;
  /** 単価が要確認の商品の数 */
  check: number;
}

/** 取引先ごとのまとめ（売上の多い順） */
export function summarizeByCustomer(rows: CustomerProductRow[]): CustomerSummary[] {
  const m = new Map<string, CustomerSummary>();
  for (const r of rows) {
    if (r.active === false) continue;
    const s = m.get(r.customerId) ?? { customerId: r.customerId, items: 0, sales: 0, profit: 0, negative: 0, check: 0 };
    s.items += 1;
    s.sales += r.sales ?? 0;
    s.profit += r.profit ?? 0;
    if (r.margin != null && r.margin < 0) s.negative += 1;
    if (r.priceNote) s.check += 1;
    m.set(r.customerId, s);
  }
  return [...m.values()].sort((a, b) => b.sales - a.sales);
}

/** 商品ごとのまとめ（同じ商品コードを、どの先にいくらで卸しているか） */
export function summarizeByProduct(rows: CustomerProductRow[]) {
  const m = new Map<string, { code: string; name: string; customers: number; quantity: number; minPrice?: number; maxPrice?: number; cost?: number; sales: number; profit: number }>();
  for (const r of rows) {
    if (r.active === false) continue;
    const s = m.get(r.code) ?? { code: r.code, name: r.name, customers: 0, quantity: 0, sales: 0, profit: 0 };
    s.customers += 1;
    s.quantity += r.quantity ?? 0;
    s.sales += r.sales ?? 0;
    s.profit += r.profit ?? 0;
    if (r.price != null) {
      s.minPrice = s.minPrice == null ? r.price : Math.min(s.minPrice, r.price);
      s.maxPrice = s.maxPrice == null ? r.price : Math.max(s.maxPrice, r.price);
    }
    if (r.cost != null) s.cost = r.cost;
    m.set(r.code, s);
  }
  return [...m.values()].sort((a, b) => b.sales - a.sales);
}
