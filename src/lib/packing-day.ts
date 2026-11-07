// 今日の包装（⑧・担当者 11/7「包装も製造の中に。今日の包装の一覧・変更で減った数」）。
// その納品日の注文（確定・要確認。取消は除く）を、商品 × 包装（注文の単位と入数）でまとめる。
// 変更は①の orderChanges・changesByProduct（製造計画の「変更 N」と同じ数え方）。商品ごとの +/− を、その商品のいちばん上の行に出す。
import "server-only";
import { allOrders } from "@/demo/all-orders";
import { loadMasters } from "@/lib/masters/seed-db";
import { changesByProduct, orderChanges } from "@/lib/order-changes";

export interface PackRow { productId: string; name: string; unit: string; per: number; quantity: number; pieces: number; customers: number; plus: number; minus: number }
export interface PackingDay { date: string; rows: PackRow[]; quantity: number; pieces: number; /** 変更の件数（①の orderChanges の件数） */ changes: number; plus: number; minus: number }

export async function packingDay(date: string): Promise<PackingDay> {
  const [{ orders }, masters] = await Promise.all([allOrders(), loadMasters()]);
  const name = new Map((masters.products ?? []).map((p) => [p.id, p.name]));
  const rows = new Map<string, PackRow & { cs: Set<string> }>();
  for (const o of orders.filter((x) => x.deliveryDate === date && (x.intent ?? "new") === "new" && x.status !== "cancelled")) {
    for (const l of o.lines) {
      if (!l.productId) continue;
      const per = l.piecesPerUnit > 0 ? l.piecesPerUnit : 1;
      const unit = l.unit || "個";
      const k = `${l.productId}|${unit}|${per}`;
      let r = rows.get(k);
      if (!r) rows.set(k, (r = { productId: l.productId, name: name.get(l.productId) ?? l.productId, unit, per, quantity: 0, pieces: 0, customers: 0, plus: 0, minus: 0, cs: new Set() }));
      r.quantity += l.quantity;
      r.pieces += l.pieces || l.quantity * per;
      r.cs.add(o.customerId);
    }
  }
  const list = [...rows.values()].map(({ cs, ...r }) => ({ ...r, customers: cs.size })).sort((a, b) => a.name.localeCompare(b.name, "ja") || a.per - b.per);
  const ch = orderChanges(orders, date);
  for (const c of changesByProduct(ch)) {
    const r = list.find((x) => x.productId === c.productId);
    if (r) {
      r.plus += c.plus;
      r.minus += c.minus;
    } else list.push({ productId: c.productId, name: name.get(c.productId) ?? c.productId, unit: "個", per: 1, quantity: 0, pieces: 0, customers: 0, plus: c.plus, minus: c.minus });
  }
  return {
    date, rows: list, changes: ch.length,
    quantity: list.reduce((a, r) => a + r.quantity, 0), pieces: list.reduce((a, r) => a + r.pieces, 0),
    plus: list.reduce((a, r) => a + r.plus, 0), minus: list.reduce((a, r) => a + r.minus, 0),
  };
}
