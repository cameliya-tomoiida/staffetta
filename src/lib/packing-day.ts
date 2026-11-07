// 今日の包装（⑧・担当者 11/7「包装も製造の中に。今日の包装の一覧・変更で減った数」）。
// その納品日の注文（確定・要確認。取消は除く）を、商品 × 包装（注文の単位と入数）でまとめる。
// 変更で減った数: 注文の数を直して減った分（直した記録 edits）と、取り消した注文の分。
import "server-only";
import { allOrders } from "@/demo/all-orders";
import { loadMasters } from "@/lib/masters/seed-db";

export interface PackRow { productId: string; name: string; unit: string; per: number; quantity: number; pieces: number; customers: number; reduced: number }
export interface PackingDay { date: string; rows: PackRow[]; quantity: number; pieces: number; reduced: number }

export async function packingDay(date: string): Promise<PackingDay> {
  const [{ orders }, masters] = await Promise.all([allOrders(), loadMasters()]);
  const name = new Map((masters.products ?? []).map((p) => [p.id, p.name]));
  const rows = new Map<string, PackRow & { cs: Set<string> }>();
  const row = (pid: string, unit: string, per: number) => {
    const k = `${pid}|${unit}|${per}`;
    let r = rows.get(k);
    if (!r) rows.set(k, (r = { productId: pid, name: name.get(pid) ?? pid, unit, per, quantity: 0, pieces: 0, customers: 0, reduced: 0, cs: new Set() }));
    return r;
  };
  for (const o of orders.filter((x) => x.deliveryDate === date && (x.intent ?? "new") === "new")) {
    for (const l of o.lines) {
      if (!l.productId) continue;
      const per = l.piecesPerUnit > 0 ? l.piecesPerUnit : 1;
      const r = row(l.productId, l.unit || "個", per);
      if (o.status === "cancelled") {
        r.reduced += l.pieces || l.quantity * per;
        continue;
      }
      r.quantity += l.quantity;
      r.pieces += l.pieces || l.quantity * per;
      r.cs.add(o.customerId);
      for (const e of l.edits ?? []) {
        if (e.field !== "quantity") continue;
        const d = Number(e.from) - Number(e.to);
        if (d > 0) r.reduced += d * per;
      }
    }
  }
  const list = [...rows.values()].filter((r) => r.quantity > 0 || r.reduced > 0).map(({ cs, ...r }) => ({ ...r, customers: cs.size }))
    .sort((a, b) => a.name.localeCompare(b.name, "ja") || a.per - b.per);
  return { date, rows: list, quantity: list.reduce((a, r) => a + r.quantity, 0), pieces: list.reduce((a, r) => a + r.pieces, 0), reduced: list.reduce((a, r) => a + r.reduced, 0) };
}
