// 発注の合計と注文の合計の照らし合わせ（⑧ C・事務の困りごと）。純関数。
// 事務の人（見直しの担当）が、発注書の数と注文の数が合っているかを目で見直していた手間を減らす。
//   - 承認・送信済みの発注書は、そのときの中身で止まる。あとで注文が増えた・減った・取り消された → 合わない（赤・黄）
//   - 仕入品なのに、どの発注書にも入っていない（仕入先が決まっていない など） → 赤
//   - 入数で切り上げた余り（1袋に満たない分）は「合っている」とみなす
import type { PurchaseOrderDraft } from "./purchase";
import type { StoredPurchaseOrder } from "./purchase-records";

export type CheckState = "ok" | "short" | "over" | "missing";

export interface CheckRow {
  poId?: string;
  supplierName?: string;
  deliveryName?: string;
  itemId: string;
  name: string;
  /** 今の注文の数（個） */
  ordered: number;
  /** 発注書の数（個）。承認・送信済みなら、そのときの中身 */
  inPo: number;
  /** 1袋（発注の単位）の個数 */
  perUnit: number;
  /** 発注書の状態（承認・送信済みなら、中身が止まっている） */
  status: "draft" | "approved" | "sent" | "none";
  state: CheckState;
  text: string;
}

/**
 * fresh … 今の注文で計算した仕入品の発注書（下書き）
 * stored … 保存した発注書（承認・送信済みの中身）。同じ日に届く分だけを渡す
 * buyOrdered … その日の仕入品の注文（商品ごとの個数。発注書に入っているかを見る）
 */
export function checkPurchaseTotals(fresh: PurchaseOrderDraft[], stored: StoredPurchaseOrder[], buyOrdered: { productId: string; name: string; pieces: number }[] = []): CheckRow[] {
  const keep = new Map(stored.filter((s) => s.status !== "draft").map((s) => [s.id, s]));
  const rows: CheckRow[] = [];
  const seen = new Set<string>();
  for (const po of fresh) {
    if (po.kind !== "product") continue;
    const s = keep.get(po.id);
    const ids = new Set([...po.lines.map((l) => l.itemId), ...(s?.lines ?? []).map((l) => l.itemId)]);
    for (const itemId of ids) {
      seen.add(itemId);
      const now = po.lines.find((l) => l.itemId === itemId);
      const old = s?.lines.find((l) => l.itemId === itemId);
      const ordered = now?.needQuantity ?? 0;
      const inPo = s ? (old?.quantity ?? 0) : (now?.quantity ?? 0);
      const units = (s ? old?.units : now?.units) ?? now?.units ?? 0;
      const perUnit = units > 0 ? Math.max(1, Math.round(((s ? old?.quantity : now?.quantity) ?? 0) / units)) : 1;
      const name = now?.name ?? old?.name ?? itemId;
      const status = s?.status ?? "draft";
      let state: CheckState = "ok";
      let text = "合っています";
      if (inPo < ordered) {
        state = "short";
        text = `発注が ${ordered - inPo}個 足りません（注文 ${ordered}個・発注 ${inPo}個）${s ? "。承認したあとに注文が増えました" : ""}`;
      } else if (inPo - ordered >= perUnit) {
        state = "over";
        text = ordered === 0
          ? `注文が無くなりました（発注 ${inPo}個）。取り消しを仕入先に伝えてください`
          : `発注が ${inPo - ordered}個 多いです（注文 ${ordered}個・発注 ${inPo}個）${s ? "。承認したあとに注文が減りました" : ""}`;
      } else if (inPo > ordered) {
        text = `合っています（入数の切り上げの余り ${inPo - ordered}個）`;
      }
      rows.push({ poId: po.id, supplierName: po.supplierName, deliveryName: po.deliveryName, itemId, name, ordered, inPo, perUnit, status, state, text });
    }
  }
  // 承認・送信済みなのに、今の計算で発注書ごと無くなった（注文が全部取り消された）
  for (const s of keep.values()) {
    if (fresh.some((p) => p.id === s.id) || !s.lines.some((l) => l.itemType === "product")) continue;
    for (const l of s.lines.filter((x) => x.itemType === "product")) {
      seen.add(l.itemId);
      rows.push({ poId: s.id, itemId: l.itemId, name: l.name, ordered: 0, inPo: l.quantity, perUnit: 1, status: s.status, state: "over", text: `注文が無くなりました（発注 ${l.quantity}個）。取り消しを仕入先に伝えてください` });
    }
  }
  for (const b of buyOrdered) {
    if (seen.has(b.productId) || b.pieces <= 0) continue;
    rows.push({ itemId: b.productId, name: b.name, ordered: b.pieces, inPo: 0, perUnit: 1, status: "none", state: "missing", text: `注文 ${b.pieces}個 が、どの発注書にも入っていません（仕入先・入数を商品のマスタで決めてください）` });
  }
  const rank: Record<CheckState, number> = { missing: 0, short: 1, over: 2, ok: 3 };
  return rows.sort((a, b) => rank[a.state] - rank[b.state] || (a.supplierName ?? "").localeCompare(b.supplierName ?? "", "ja") || a.name.localeCompare(b.name, "ja"));
}
