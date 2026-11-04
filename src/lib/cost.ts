// 原価と利益（軽い作り）: 商品ごとに 材料費・包材費・人件費 と 売価 から粗利を出す。
// データ（単価・人件費など）が入っていれば計算するだけ。無い項目は 0 として「未入力」を返す。
import type { BuySpec } from "@/data/production";
import type { DayTotals } from "./aggregate";
import { allProducts, findDough, findMaterial, findProduct, findSupplier, findTopping } from "./catalog";
import type { PipelineResult } from "./pipeline";
import type { ProductionPlan } from "./production";
import type { PurchaseOrderDraft } from "./purchase";

export interface ProductCost {
  productId: string;
  name: string;
  kind: "make" | "buy" | "repack" | "unknown";
  price: number;
  /** 材料費（自社製造: 生地＋トッピング、ロス込み） or 仕入値 */
  materialCost: number;
  packagingCost: number;
  laborCost: number;
  /** 合計原価 */
  cost: number;
  /** 粗利 = 売価 − 原価 */
  gross: number;
  /** 粗利率（売価が0なら 0） */
  grossRate: number;
  /** 未入力の項目 */
  missing: string[];
}

const yen = (n: number) => Math.round(n * 100) / 100;
const r0 = (n: number) => Math.round(n);
const rate = (sales: number, cost: number) => (sales > 0 ? Math.round(((sales - cost) / sales) * 1000) / 1000 : 0);

/** 材料 1kg あたりの円 */
function yenPerKg(materialId: string): number | undefined {
  const m = findMaterial(materialId);
  if (!m) return undefined;
  return m.unitCost / (m.kgPerUnit || 1);
}

/** 生地 1g あたりの材料費（円）。ベーカーズ％の配合から */
export function doughYenPerGram(doughId: string): number {
  const d = findDough(doughId);
  if (!d) return 0;
  const total = d.items.reduce((s, i) => s + i.percent, 0);
  const yenPerFlourKgSet = d.items.reduce((s, i) => s + (i.percent / 100) * (yenPerKg(i.materialId) ?? 0), 0);
  // 粉1kg を基準に、(配合合計/100) kg の生地ができる
  return yenPerFlourKgSet / (total / 100) / 1000;
}

/**
 * 仕入品の1個あたりの仕入値（円）。
 * 入数ごとの仕入値（円/袋）があれば 袋の値段 ÷ 入数、無ければ unitCost。わからなければ undefined。
 */
export function buyUnitCost(spec: BuySpec, packSize?: number): number | undefined {
  const size = packSize ?? spec.packSizes[0];
  const price = spec.packPrices?.[size];
  if (price !== undefined && size > 0) return price / size;
  return spec.unitCost;
}

/** 仕入品を 袋数 × 入数 で買ったときの金額（円） */
export function buyPackCost(spec: BuySpec, packs: number, packSize: number): number | undefined {
  const price = spec.packPrices?.[packSize];
  if (price !== undefined) return price * packs;
  return spec.unitCost !== undefined ? spec.unitCost * packs * packSize : undefined;
}

export function productCost(productId: string): ProductCost {
  const p = findProduct(productId);
  const missing: string[] = [];
  const base = { productId, name: p?.name ?? productId, price: p?.price ?? 0 };
  const spec = p?.spec;
  let kind: ProductCost["kind"] = "unknown";
  let materialCost = 0, packagingCost = 0, laborCost = 0;

  if (spec?.kind === "make") {
    kind = "make";
    const d = findDough(spec.doughId);
    materialCost = d ? (spec.doughGram / (1 - d.lossRate)) * doughYenPerGram(spec.doughId) : 0;
    if (spec.toppingId)
      for (const i of findTopping(spec.toppingId)?.items ?? []) materialCost += (i.gramsPerPiece / 1000) * (yenPerKg(i.materialId) ?? 0);
    packagingCost = spec.packagingCost ?? 0;
    laborCost = spec.laborCost ?? 0;
    if (spec.packagingCost === undefined) missing.push("包材費");
    if (spec.laborCost === undefined) missing.push("人件費");
  } else if (spec?.kind === "buy") {
    kind = "buy";
    const u = buyUnitCost(spec);
    materialCost = u ?? 0;
    if (u === undefined) missing.push("仕入単価");
  } else if (spec?.kind === "repack") {
    kind = "repack";
    const src = findProduct(spec.sourceProductId)?.spec;
    const u = src?.kind === "buy" ? buyUnitCost(src) : undefined;
    if (src?.kind === "buy" && u !== undefined && src.slicesPerItem) materialCost = (u / src.slicesPerItem) * spec.slicesPerPack;
    else missing.push("元の食パンの仕入単価");
    packagingCost = spec.packagingCost ?? 0;
  } else missing.push("作り方・仕入れ方");

  if (!p?.price) missing.push("売価");
  const cost = materialCost + packagingCost + laborCost;
  const gross = base.price - cost;
  return {
    ...base, kind,
    materialCost: yen(materialCost), packagingCost: yen(packagingCost), laborCost: yen(laborCost),
    cost: yen(cost), gross: yen(gross),
    grossRate: rate(base.price, cost),
    missing,
  };
}

/** 全商品の原価表 */
export function costTable(): ProductCost[] {
  return allProducts().map((p) => productCost(p.id));
}

/** 1日の売上・原価・粗利（集計の個数 × 商品ごとの1個の原価）。仕入の余りまで見るなら productMargins */
export function dailyProfit(totals: { productId: string; pieces: number }[]) {
  let sales = 0, cost = 0;
  for (const t of totals) {
    const c = productCost(t.productId);
    sales += c.price * t.pieces;
    cost += c.cost * t.pieces;
  }
  return { sales: r0(sales), cost: r0(cost), gross: r0(sales - cost), grossRate: rate(sales, cost) };
}

// ───────── 今日の製造の材料費・商品ごとの粗利 ─────────

export interface MaterialCostLine {
  materialId: string;
  name: string;
  unit: string;
  /** 使う量（材料の単位） */
  needUnits: number;
  /** 円 / 材料の単位 */
  unitCost: number;
  cost: number;
}

export interface ProductionMaterialCost {
  /** 材料費の合計（円）。水は 0 円 */
  total: number;
  /** 材料ごと（金額の大きい順） */
  lines: MaterialCostLine[];
  /** 生地ごと・トッピングごとの材料費 */
  byDough: { doughId: string; name: string; cost: number }[];
  byTopping: { toppingId: string; name: string; cost: number }[];
}

/** 今日の製造に使う材料費の合計（生地はロス込み＋トッピング）。/plan・/purchase から呼ぶ */
export function productionMaterialCost(plan: ProductionPlan): ProductionMaterialCost {
  const lines = new Map<string, MaterialCostLine>();
  const add = (materialId: string, kg: number) => {
    const m = findMaterial(materialId);
    const units = kg / (m?.kgPerUnit || 1);
    const l = lines.get(materialId) ?? { materialId, name: m?.name ?? materialId, unit: m?.unit ?? "kg", needUnits: 0, unitCost: m?.unitCost ?? 0, cost: 0 };
    l.needUnits += units;
    l.cost += units * l.unitCost;
    lines.set(materialId, l);
    return units * l.unitCost;
  };
  const byDough = plan.doughs.map((d) => ({
    doughId: d.doughId, name: d.name, cost: r0(d.ingredients.reduce((s, i) => s + add(i.materialId, i.kg), 0)),
  }));
  const byTopping = plan.toppings.map((t) => {
    const tp = findTopping(t.toppingId);
    const cost = (tp?.items ?? []).reduce((s, i) => s + add(i.materialId, (i.gramsPerPiece * t.pieces) / 1000), 0);
    return { toppingId: t.toppingId, name: tp?.name ?? t.toppingId, cost: r0(cost) };
  });
  const list = [...lines.values()]
    .map((l) => ({ ...l, needUnits: Math.round(l.needUnits * 1000) / 1000, cost: r0(l.cost) }))
    .sort((a, b) => b.cost - a.cost);
  return { total: list.reduce((s, l) => s + l.cost, 0), lines: list, byDough, byTopping };
}

export interface ProductMargin {
  productId: string;
  name: string;
  kind: ProductCost["kind"];
  /** 注文の個数 */
  pieces: number;
  price: number;
  /** 売上 = 売価 × 個数 */
  sales: number;
  /** 原価（自社製造: 1個の原価×個数。仕入品: 実際に買う袋数×仕入値＝余りの分も入る） */
  cost: number;
  gross: number;
  grossRate: number;
  /** 仕入品: 実際に買う個数（余りを含む） */
  purchasedPieces?: number;
  /** 未入力の項目 */
  missing: string[];
}

export interface MarginSummary {
  products: ProductMargin[];
  total: { sales: number; cost: number; gross: number; grossRate: number };
}

/** 発注書の1行の仕入額（円）。仕入品でなければ undefined */
function lineBuyCost(l: { itemType: string; itemId: string; units: number; quantity: number }): number | undefined {
  if (l.itemType !== "product") return undefined;
  const spec = findProduct(l.itemId)?.spec;
  if (spec?.kind !== "buy") return undefined;
  const packSize = l.units > 0 ? l.quantity / l.units : 1;
  return buyPackCost(spec, l.units, packSize) ?? 0;
}

/**
 * 商品ごとの粗利。
 * 仕入品の発注書（下書き）を渡すと、仕入品は「実際に買う袋数 × 仕入値」で原価を出す（65個に 6個入×11袋なら 66個分）。
 * 食パンの包み直し（1枚入り・2枚入り）は、元の 3斤 の仕入額を枚数の割合で分ける。
 * 渡さなければ「1個の原価 × 個数」。
 */
export function productMargins(totals: DayTotals, productPurchaseOrders?: PurchaseOrderDraft[]): MarginSummary {
  const bought = new Map<string, { cost: number; pieces: number }>();
  for (const po of productPurchaseOrders ?? [])
    for (const l of po.lines) {
      const cost = lineBuyCost(l);
      if (cost === undefined) continue;
      const b = bought.get(l.itemId) ?? { cost: 0, pieces: 0 };
      b.cost += cost;
      b.pieces += l.quantity;
      bought.set(l.itemId, b);
    }
  const sliceTotal = new Map<string, number>();
  for (const t of totals.products) {
    const spec = findProduct(t.productId)?.spec;
    if (spec?.kind === "repack") sliceTotal.set(spec.sourceProductId, (sliceTotal.get(spec.sourceProductId) ?? 0) + t.pieces * spec.slicesPerPack);
  }

  const products = totals.products.map((t): ProductMargin => {
    const c = productCost(t.productId);
    const spec = findProduct(t.productId)?.spec;
    let cost = c.cost * t.pieces;
    let purchasedPieces: number | undefined;
    if (spec?.kind === "buy" && bought.has(t.productId)) {
      const b = bought.get(t.productId)!;
      cost = b.cost;
      purchasedPieces = b.pieces;
    } else if (spec?.kind === "repack" && bought.has(spec.sourceProductId)) {
      const share = (t.pieces * spec.slicesPerPack) / (sliceTotal.get(spec.sourceProductId) || 1);
      cost = bought.get(spec.sourceProductId)!.cost * share + (spec.packagingCost ?? 0) * t.pieces;
    }
    const sales = c.price * t.pieces;
    return {
      productId: t.productId, name: c.name, kind: c.kind, pieces: t.pieces, price: c.price,
      sales: r0(sales), cost: r0(cost), gross: r0(sales) - r0(cost), grossRate: rate(sales, cost),
      purchasedPieces, missing: c.missing,
    };
  });
  const sales = products.reduce((s, p) => s + p.sales, 0);
  const cost = products.reduce((s, p) => s + p.cost, 0);
  return { products, total: { sales, cost, gross: sales - cost, grossRate: rate(sales, cost) } };
}

export interface DayCostSummary {
  date: string;
  /** 今日の製造に使う材料費 */
  materialCost: ProductionMaterialCost;
  /** 仕入品の仕入額（仕入先ごと。余りの分も入る） */
  purchaseCost: { total: number; bySupplier: { supplierId: string; name: string; cost: number }[] };
  /** 商品ごとの粗利と合計 */
  margins: MarginSummary;
}

/** runPipeline の結果から、その日の 材料費・仕入額・商品ごとの粗利 をまとめて出す */
export function dayCostSummary(r: PipelineResult): DayCostSummary {
  const bySupplier = new Map<string, number>();
  for (const po of r.productPurchaseOrders)
    for (const l of po.lines) {
      const cost = lineBuyCost(l);
      if (cost !== undefined) bySupplier.set(po.supplierId, (bySupplier.get(po.supplierId) ?? 0) + cost);
    }
  const list = [...bySupplier.entries()].map(([supplierId, cost]) => ({ supplierId, name: findSupplier(supplierId)?.name ?? supplierId, cost: r0(cost) }));
  return {
    date: r.date,
    materialCost: productionMaterialCost(r.production),
    purchaseCost: { total: list.reduce((s, x) => s + x.cost, 0), bySupplier: list },
    margins: productMargins(r.totals, r.productPurchaseOrders),
  };
}
