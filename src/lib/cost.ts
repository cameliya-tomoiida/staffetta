// 原価と利益（軽い作り）: 商品ごとに 材料費・包材費・人件費 と 売価 から粗利を出す。
// データ（単価・人件費など）が入っていれば計算するだけ。無い項目は 0 として「未入力」を返す。
import { allProducts, findDough, findMaterial, findProduct, findTopping } from "./catalog";

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
    materialCost = spec.unitCost ?? 0;
    if (spec.unitCost === undefined) missing.push("仕入単価");
  } else if (spec?.kind === "repack") {
    kind = "repack";
    const src = findProduct(spec.sourceProductId)?.spec;
    if (src?.kind === "buy" && src.unitCost !== undefined && src.slicesPerItem)
      materialCost = (src.unitCost / src.slicesPerItem) * spec.slicesPerPack;
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
    grossRate: base.price > 0 ? Math.round((gross / base.price) * 1000) / 1000 : 0,
    missing,
  };
}

/** 全商品の原価表 */
export function costTable(): ProductCost[] {
  return allProducts().map((p) => productCost(p.id));
}

/** 1日の売上・原価・粗利（集計の個数 × 商品ごとの原価） */
export function dailyProfit(totals: { productId: string; pieces: number }[]) {
  let sales = 0, cost = 0;
  for (const t of totals) {
    const c = productCost(t.productId);
    sales += c.price * t.pieces;
    cost += c.cost * t.pieces;
  }
  return { sales: Math.round(sales), cost: Math.round(cost), gross: Math.round(sales - cost), grossRate: sales ? Math.round(((sales - cost) / sales) * 1000) / 1000 : 0 };
}
