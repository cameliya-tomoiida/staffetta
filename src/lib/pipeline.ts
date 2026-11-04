// 通しの計算: 注文 → 集計 → 仕入品の発注書（下書き）→ 製造計画・工程表 → 材料の所要量 → 材料の発注書（下書き）
// 画面（/orders・/plan・/purchase）は、これを1回呼べば必要なものが全部そろう。
import type { Order } from "@/data/types";
import { totalsForDate, type DayTotals } from "./aggregate";
import { materialRequirements, materialShortages, type MaterialRequirement, type MaterialShortage, type ShortageOptions } from "./materials";
import { buildSchedule, planProduction, scheduleSummary, type ProductionOptions, type ProductionPlan, type ScheduleOptions, type ScheduleRow } from "./production";
import { addDays, buildMaterialPurchaseOrders, buildProductPurchaseOrders, type ProductPurchaseOptions, type PurchaseOrderDraft } from "./purchase";

export interface PipelineOptions {
  /** 製造日 = 納品日 + この日数（初期値 0: 当日の朝に作る） */
  productionOffsetDays?: number;
  /** 材料がほしい日 = 製造日 − この日数（初期値 1: 前日までに届く） */
  materialArriveDaysBefore?: number;
  purchase?: ProductPurchaseOptions;
  production?: ProductionOptions;
  schedule?: ScheduleOptions;
  shortage?: ShortageOptions;
}

export interface PipelineResult {
  date: string;
  productionDate: string;
  totals: DayTotals;
  productPurchaseOrders: PurchaseOrderDraft[];
  production: ProductionPlan;
  schedule: ScheduleRow[];
  scheduleSummary: ReturnType<typeof scheduleSummary>;
  materials: MaterialRequirement[];
  shortages: MaterialShortage[];
  materialPurchaseOrders: PurchaseOrderDraft[];
  /** すべての注意（集計・製造） */
  warnings: string[];
}

/** 1つの納品日について、通しで計算する */
export function runPipeline(orders: Order[], date: string, opts: PipelineOptions = {}): PipelineResult {
  const totals = totalsForDate(orders, date);
  const productionDate = addDays(date, opts.productionOffsetDays ?? 0);
  const productPurchaseOrders = buildProductPurchaseOrders(totals, opts.purchase);
  const production = { ...planProduction(totals, opts.production), date: productionDate };
  const schedule = buildSchedule(production, opts.schedule);
  const materials = materialRequirements([production]);
  const shortages = materialShortages(materials, opts.shortage);
  const materialPurchaseOrders = buildMaterialPurchaseOrders(shortages, addDays(productionDate, -(opts.materialArriveDaysBefore ?? 1)));
  return {
    date,
    productionDate,
    totals,
    productPurchaseOrders,
    production,
    schedule,
    scheduleSummary: scheduleSummary(schedule),
    materials,
    shortages,
    materialPurchaseOrders,
    warnings: [...totals.warnings, ...production.warnings],
  };
}
