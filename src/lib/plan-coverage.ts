// 確定した注文が、製造計画・発注に入ったかの確かめ（作者 11/6 (E)。事務の人「製造依頼に入れ忘れた」の失敗から）。純関数。
// 「今日の確定 ◯件 → 製造計画に入った ◯件」を出し、入っていない明細と、計画を作ったあとに確定した注文を見つける。
//   入った ＝ 明細の商品が、生地の仕込み（自社製造）・包み直し・仕入品の発注書のどれかに出ている
//   入っていない例 ＝ 商品が決まっていない明細、レシピ・ライン・仕入先が無くて計画に出ない商品
import type { Order } from "@/data/types";
import { countsInTotals } from "./aggregate";
import type { PipelineResult } from "./pipeline";

export interface CoverageMiss {
  orderId: string;
  customerId: string;
  productId: string;
  why: string;
}

export interface PlanCoverage {
  date: string;
  /** その日の確定した注文の数 */
  confirmed: number;
  /** 全部の明細が計画・発注に入った注文の数 */
  included: number;
  missing: CoverageMiss[];
  /** 計画を作った（印刷の用意をした）あとに確定した注文 */
  afterPrepared: { orderId: string; customerId: string; confirmedAt: string }[];
}

export function planCoverage(
  orders: Order[],
  date: string,
  r: Pick<PipelineResult, "production" | "productPurchaseOrders">,
  prepared?: { at: string },
): PlanCoverage {
  const planned = new Set<string>([
    ...r.production.doughs.flatMap((d) => d.items.map((i) => i.productId)),
    ...r.production.repack.map((x) => x.productId),
    ...r.productPurchaseOrders.flatMap((po) => po.lines.filter((l) => l.itemType === "product").map((l) => l.itemId)),
  ]);
  const day = orders.filter((o) => countsInTotals(o) && o.deliveryDate === date);
  const missing: CoverageMiss[] = [];
  let included = 0;
  for (const o of day) {
    const miss = o.lines
      .filter((l) => l.quantity > 0)
      .flatMap((l): CoverageMiss[] =>
        !l.productId
          ? [{ orderId: o.id, customerId: o.customerId, productId: "", why: "商品が決まっていない明細" }]
          : planned.has(l.productId)
            ? []
            : [{ orderId: o.id, customerId: o.customerId, productId: l.productId, why: "製造計画・発注に出ない商品（レシピ・ライン・仕入先の登録が無い）" }],
      );
    if (miss.length) missing.push(...miss);
    else included++;
  }
  const afterPrepared = prepared
    ? day.filter((o) => o.confirmedAt && Date.parse(o.confirmedAt) > Date.parse(prepared.at)).map((o) => ({ orderId: o.id, customerId: o.customerId, confirmedAt: o.confirmedAt! }))
    : [];
  return { date, confirmed: day.length, included, missing, afterPrepared };
}
