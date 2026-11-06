// 発注書を「仕入先 × 届け先（店番）」に分ける（⑧）。純関数。
// パンメーカーは、同じ商品でも届け先（取引先の店）ごとに店番がちがい、店番ごとに分けて発注する（便＝1便・2便も別）。
//   per_store: 店番ごとに1枚（品名・品番・数量の FAX 発注書）
//   matrix   : 1枚の表に、届け先ごとの列（商品 × 店）
// 発注書の行が持つ「取引先ごとの内訳（packs）」を、店番の「届ける取引先」に振り分ける。どの店にも入らない取引先の分は「ほかの分を入れる店」へ。
import type { SupplierStoreMaster } from "@/data/types";
import type { PurchaseOrderDraft } from "./purchase";

export interface StoreLine {
  itemId: string;
  name: string;
  /** 仕入先の品番 */
  itemNo?: string;
  /** 発注する数（発注単位。袋・個） */
  units: number;
  unitLabel: string;
}

export interface StoreSheet {
  storeNo: string;
  storeName: string;
  lines: StoreLine[];
  total: number;
}

export interface StoreSplit {
  poId: string;
  supplierId: string;
  deliveryDate: string;
  /** 便の名前（1便・2便） */
  deliveryName: string;
  sheets: StoreSheet[];
  /** 店番の決まっていない取引先の分（「ほかの分を入れる店」も無いとき） */
  unassigned: { customerId: string; itemId: string; units: number }[];
}

/** 発注書を店番ごとに分ける。stores はその仕入先の店番だけ（使う物）。itemNoOf で商品 → 仕入先の品番 */
export function splitByStore(po: PurchaseOrderDraft, stores: SupplierStoreMaster[], itemNoOf: (itemId: string) => string | undefined = () => undefined): StoreSplit {
  const active = stores.filter((s) => s.active !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.storeNo.localeCompare(b.storeNo));
  const storeOf = new Map<string, SupplierStoreMaster>();
  for (const s of active) for (const c of s.customerIds ?? []) storeOf.set(c, s);
  const fallback = active.find((s) => s.isDefault);
  const sheets = new Map<string, StoreSheet>(active.map((s) => [s.storeNo, { storeNo: s.storeNo, storeName: s.name, lines: [], total: 0 }]));
  const unassigned: StoreSplit["unassigned"] = [];
  for (const l of po.lines) {
    const per = new Map<string, number>();
    const parts = l.customers?.length ? l.customers.map((c) => ({ customerId: c.customerId, units: c.packs })) : [{ customerId: "", units: l.units }];
    // 取引先ごとの袋の合計が発注書の数より少ないとき（余りをまとめて切り上げた分）は、ほかの分を入れる店に足す
    const sum = parts.reduce((a, p) => a + p.units, 0);
    if (l.units > sum) parts.push({ customerId: "", units: l.units - sum });
    for (const p of parts) {
      if (p.units <= 0) continue;
      const st = storeOf.get(p.customerId) ?? fallback;
      if (!st) {
        unassigned.push({ customerId: p.customerId, itemId: l.itemId, units: p.units });
        continue;
      }
      per.set(st.storeNo, (per.get(st.storeNo) ?? 0) + p.units);
    }
    for (const [no, units] of per) {
      const sh = sheets.get(no)!;
      const itemNo = itemNoOf(l.itemId);
      sh.lines.push({ itemId: l.itemId, name: l.name, ...(itemNo ? { itemNo } : {}), units, unitLabel: l.unitLabel });
      sh.total += units;
    }
  }
  return {
    poId: po.id, supplierId: po.supplierId, deliveryDate: po.deliveryDate, deliveryName: po.deliveryName,
    sheets: [...sheets.values()].filter((s) => s.lines.length),
    unassigned,
  };
}

/** 1枚に届け先ごとの列の表（matrix）: 行＝商品、列＝店。合計の列つき */
export function storeMatrix(split: StoreSplit): { stores: { storeNo: string; storeName: string }[]; rows: { itemId: string; name: string; itemNo?: string; unitLabel: string; byStore: Record<string, number>; total: number }[] } {
  const stores = split.sheets.map((s) => ({ storeNo: s.storeNo, storeName: s.storeName }));
  const rows = new Map<string, { itemId: string; name: string; itemNo?: string; unitLabel: string; byStore: Record<string, number>; total: number }>();
  for (const s of split.sheets) {
    for (const l of s.lines) {
      const r = rows.get(l.itemId) ?? { itemId: l.itemId, name: l.name, ...(l.itemNo ? { itemNo: l.itemNo } : {}), unitLabel: l.unitLabel, byStore: {}, total: 0 };
      r.byStore[s.storeNo] = (r.byStore[s.storeNo] ?? 0) + l.units;
      r.total += l.units;
      rows.set(l.itemId, r);
    }
  }
  return { stores, rows: [...rows.values()] };
}

/** 品番を発注書に書く形（4けた、左を 0 で埋める） */
export const itemNo4 = (n?: string) => (n && /^\d+$/.test(n) ? n.padStart(4, "0") : (n ?? ""));
