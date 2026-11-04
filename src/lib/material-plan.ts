// 材料の発注を「何日先まで」見て決める（既定 3日）。
// 日ごとに 製造計画 → 材料の所要量 を出し、在庫を日ごとに減らしていって、
// 安全在庫を割る日の前日（材料がほしい日）に届くように発注する。
// 発注単位（25kg袋など）で切り上げ、最小ロット（材料 → 仕入先 → 1）より少なくは頼まない。
// 締めは仕入先マスタの締め時刻とリードタイム（無ければ 1日）から出す。
import type { Order } from "@/data/types";
import { totalsForDate } from "./aggregate";
import { allMaterials, findMaterial, findSupplier } from "./catalog";
import { materialRequirements } from "./materials";
import { planProduction, type ProductionOptions } from "./production";
import { addDays, buildMaterialPurchaseOrders, type MaterialShortageLike, type PurchaseOrderDraft } from "./purchase";

export interface MaterialPlanOptions {
  /** 何日先まで見るか（納品日 fromDate から数えて。既定 3） */
  days?: number;
  /** 製造日 = 納品日 + この日数（既定 0） */
  productionOffsetDays?: number;
  /** 材料がほしい日 = 製造日 − この日数（既定 1） */
  arriveDaysBefore?: number;
  /** 在庫を上書き（棚卸の結果など）。materialId → 量（材料の単位） */
  stock?: Record<string, number>;
  ignoreSafetyStock?: boolean;
  production?: ProductionOptions;
  /** 今の時刻（ISO）。渡すと、締めを過ぎた発注書に注意を付ける */
  now?: string;
}

export interface MaterialDayRow {
  /** 納品日 */
  date: string;
  productionDate: string;
  /** その日に使う量 */
  need: number;
  /** 使う前の在庫（届いた分を含む） */
  stockBefore: number;
  /** この日の製造のために頼む量（発注単位の数 × 発注単位） */
  orderUnits: number;
  orderPacks: number;
  /** 届く日（材料がほしい日） */
  arriveDate?: string;
  /** 使ったあとの在庫 */
  stockAfter: number;
}

export interface MaterialPlanRow {
  materialId: string;
  name: string;
  unit: string;
  supplierId: string;
  orderUnitLabel: string;
  minLot: number;
  stock: number;
  safetyStock: number;
  totalNeed: number;
  totalOrderPacks: number;
  days: MaterialDayRow[];
}

export interface MaterialPlan {
  fromDate: string;
  days: number;
  dates: string[];
  rows: MaterialPlanRow[];
  /** 材料の発注書の下書き（仕入先 × 届く日ごと） */
  purchaseOrders: PurchaseOrderDraft[];
  warnings: string[];
}

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

export function planMaterialOrders(orders: Order[], fromDate: string, opts: MaterialPlanOptions = {}): MaterialPlan {
  const days = Math.max(1, Math.floor(opts.days ?? 3));
  const offset = opts.productionOffsetDays ?? 0;
  const before = opts.arriveDaysBefore ?? 1;
  const dates = Array.from({ length: days }, (_, i) => addDays(fromDate, i));

  // 日ごとの所要量
  const needByDay = dates.map((date) => {
    const plan = planProduction(totalsForDate(orders, date), opts.production);
    return new Map(materialRequirements([plan]).filter((r) => !r.noPurchase).map((r) => [r.materialId, r.needUnits]));
  });

  const rows: MaterialPlanRow[] = [];
  const toOrder = new Map<string, MaterialShortageLike[]>(); // 届く日 → 発注
  for (const m of allMaterials()) {
    if (m.noPurchase || !needByDay.some((n) => n.has(m.id))) continue;
    let stock = opts.stock?.[m.id] ?? m.stock;
    const safety = opts.ignoreSafetyStock ? 0 : m.safetyStock;
    const dayRows: MaterialDayRow[] = dates.map((date, i) => {
      const need = needByDay[i].get(m.id) ?? 0;
      const productionDate = addDays(date, offset);
      const short = round(need + safety - stock);
      let orderPacks = 0;
      let arriveDate: string | undefined;
      if (need > 0 && short > 0) {
        orderPacks = Math.max(m.minLot, Math.ceil(round(short / m.orderUnit, 6)));
        arriveDate = addDays(productionDate, -before);
        const list = toOrder.get(arriveDate) ?? [];
        const same = list.find((x) => x.materialId === m.id);
        if (same) {
          same.orderPacks += orderPacks;
          same.orderUnits = round(same.orderPacks * m.orderUnit);
          same.needUnits = round(same.needUnits + need);
        } else list.push({ materialId: m.id, needUnits: need, orderPacks, orderUnits: round(orderPacks * m.orderUnit) });
        toOrder.set(arriveDate, list);
      }
      const orderUnits = round(orderPacks * m.orderUnit);
      const stockBefore = round(stock + orderUnits);
      stock = round(stockBefore - need);
      return { date, productionDate, need, stockBefore, orderUnits, orderPacks, arriveDate, stockAfter: stock };
    });
    rows.push({
      materialId: m.id, name: m.name, unit: m.unit, supplierId: m.supplierId, orderUnitLabel: m.orderUnitLabel, minLot: m.minLot,
      stock: opts.stock?.[m.id] ?? m.stock, safetyStock: safety,
      totalNeed: round(dayRows.reduce((s, d) => s + d.need, 0)),
      totalOrderPacks: dayRows.reduce((s, d) => s + d.orderPacks, 0),
      days: dayRows,
    });
  }

  const warnings: string[] = [];
  const purchaseOrders = [...toOrder.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([arrive, list]) => buildMaterialPurchaseOrders(list, arrive))
    .map((po) => {
      // 最小ロットで増やした品目に印を付ける
      for (const l of po.lines) {
        const m = findMaterial(l.itemId);
        if (m && m.minLot > 1 && l.units === m.minLot) (l.notes ??= []).push(`最小ロット ${m.minLot}${m.orderUnitLabel}`);
      }
      const s = findSupplier(po.supplierId);
      const lead = s?.deliveries[0]?.leadDays ?? 1;
      po.notes.push(`リードタイム ${lead}日`);
      if (!po.cutoffSet) po.notes.push("締め時刻が未設定です");
      if (opts.now && po.cutoffSet && Date.parse(po.cutoffAt) < Date.parse(opts.now)) {
        po.notes.push("締めを過ぎています。仕入先に電話で確認してください");
        warnings.push(`${po.supplierName}（${po.deliveryDate} 着）: 締め ${po.cutoffAt} を過ぎています`);
      }
      return po;
    });

  return { fromDate, days, dates, rows, purchaseOrders, warnings };
}
