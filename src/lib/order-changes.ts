// 注文の変更（作者 11/7 担当者「1日に10社くらい変更が来る。保育園は前日の夕方や当日も」）。
// 変更の FAX・LINE を人が確定すると、元の注文の数が書き換わり、製造の計画・材料・包装は計算し直される（aggregate は new だけを数える）。
// ここでは「何が・どれだけ・どこの取引先で変わったか」を、納品日ごとに出す（製造・包装に「変更 ◯件」と見せる）。純関数。
import type { Order } from "@/data/types";

export interface OrderChange {
  orderId: string;
  customerId: string;
  productId: string;
  /** 増えた（+）・減った（−）個数 */
  pieces: number;
  at: string;
  kind: "change" | "add";
}

/** その納品日の、確定したあとの変更（確定した注文の数の書き換え・変更で足した注文） */
export function orderChanges(orders: Order[], date: string): OrderChange[] {
  const out: OrderChange[] = [];
  for (const o of orders) {
    if (o.deliveryDate !== date || o.status === "cancelled") continue;
    const after = Date.parse(o.confirmedAt ?? o.createdAt); // 「+09:00」と「Z」が混ざるので、時刻にしてから比べる
    if ((o.source.extra as { faxKind?: string } | undefined)?.faxKind === "change_addition") {
      for (const l of o.lines) if (l.pieces > 0) out.push({ orderId: o.id, customerId: o.customerId, productId: l.productId, pieces: l.pieces, at: o.createdAt, kind: "add" });
      continue;
    }
    if ((o.intent ?? "new") !== "new" || o.status !== "confirmed") continue;
    for (const l of o.lines)
      for (const e of l.edits) {
        if (e.field !== "quantity" || !(Date.parse(e.at) > after)) continue; // 確定する前の直し（読み違いの直し）は変更ではない
        const d = (Number(e.to) - Number(e.from)) * (l.piecesPerUnit || 1);
        if (d) out.push({ orderId: o.id, customerId: o.customerId, productId: l.productId, pieces: d, at: e.at, kind: "change" });
      }
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** 商品ごとのまとめ（+20・−10 など） */
/** added = そのうち、元の注文が見つからず新しく入れた分（差でなく全部の数。管理役2 11/7「+50 は差ではない」） */
export function changesByProduct(list: OrderChange[]): { productId: string; plus: number; minus: number; added: number; customers: string[] }[] {
  const m = new Map<string, { productId: string; plus: number; minus: number; added: number; customers: string[] }>();
  for (const c of list) {
    const x = m.get(c.productId) ?? { productId: c.productId, plus: 0, minus: 0, added: 0, customers: [] };
    if (c.kind === "add") x.added += c.pieces;
    if (c.pieces > 0) x.plus += c.pieces;
    else x.minus += -c.pieces;
    if (!x.customers.includes(c.customerId)) x.customers.push(c.customerId);
    m.set(c.productId, x);
  }
  return [...m.values()];
}
