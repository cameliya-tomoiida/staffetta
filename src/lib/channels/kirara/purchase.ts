// きららの振り分け結果から、仕入先への発注書の下書きを作る。
// 袋数の計算（入数で割る・余り）は③の buildProductPurchaseOrders をそのまま呼ぶ（ここで計算し直さない）。
//
// 振り分け先ごとの扱い（今の Excel マクロのシート分けと同じ）:
//  - ふじみ 本発注 … ふじみ相当（S07）へ、センター納品日に届く分として発注
//  - ふじみ 前日   … ふじみ相当（S07）へ、前日に届く分として発注（届いたらバラ・2個入に包み直す）
//  - ひので     … ひので相当（S03）へ、センター納品日に届く分として発注
//  - 自社本・自社包装・菓子パン … 自社で作るので発注書は作らない（製造計画に入る）
import type { DayTotals, ProductTotal } from "@/lib/aggregate";
import { findProduct } from "@/lib/catalog";
import { addDays, buildProductPurchaseOrders, type PurchaseOrderDraft } from "@/lib/purchase";
import { KIRARA_DESTS, kiraraItem, type KiraraDest } from "./config";

export const KIRARA_PURCHASE_DESTS: { dest: KiraraDest; dayOffset: number }[] = [
  { dest: "fujimi_main", dayOffset: 0 },
  { dest: "fujimi_prev", dayOffset: -1 },
  { dest: "hinode", dayOffset: 0 },
];

export interface KiraraRowLike {
  itemCode: string;
  qty: number; // パック数
  centerDate: string;
}

export function kiraraPurchaseDrafts(
  rows: KiraraRowLike[],
  opts: { customerId: string; fileName: string },
): { drafts: PurchaseOrderDraft[]; warnings: string[] } {
  const drafts: PurchaseOrderDraft[] = [];
  const warnings: string[] = [];
  const centerDates = [...new Set(rows.map((r) => r.centerDate))];
  for (const centerDate of centerDates) {
    for (const { dest, dayOffset } of KIRARA_PURCHASE_DESTS) {
      const label = KIRARA_DESTS.find((d) => d.key === dest)!.label;
      const totals = new Map<string, ProductTotal>();
      for (const r of rows.filter((r) => r.centerDate === centerDate)) {
        const item = kiraraItem(r.itemCode);
        if (!item || item.dest !== dest) continue;
        if (!item.productId) {
          warnings.push(`${label}: 商品コード ${r.itemCode} が当社の商品にひも付いていないので発注書に入れていません`);
          continue;
        }
        const p = findProduct(item.productId);
        const pieces = r.qty * item.piecesPerUnit;
        const t = totals.get(item.productId) ?? {
          productId: item.productId, name: p?.name ?? item.productId, unit: p?.unit ?? "個", pieces: 0,
          customers: [{ customerId: opts.customerId, pieces: 0, orderIds: [] }],
        };
        t.pieces += pieces;
        t.customers[0].pieces += pieces;
        totals.set(item.productId, t);
      }
      if (!totals.size) continue;
      const date = addDays(centerDate, dayOffset);
      const day: DayTotals = { date, products: [...totals.values()], warnings: [] };
      // バラ・小分けに包み直すので、得意先ごとではなく全体で袋数を出す
      for (const d of buildProductPurchaseOrders(day, { mode: "total" })) {
        drafts.push({
          ...d,
          id: `${d.id}-NS-${dest}`,
          deliveryName: [d.deliveryName, `振り分け ${label}`].filter(Boolean).join("・"),
          notes: [...d.notes, `専用サイトの CSV（${opts.fileName}）の振り分け「${label}」から作成`, ...(dayOffset < 0 ? [`センター納品 ${centerDate} の前日に届く分`] : [])],
        });
      }
    }
  }
  return { drafts, warnings };
}
