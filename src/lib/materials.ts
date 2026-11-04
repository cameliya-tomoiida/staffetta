// レシピ（ベーカーズ％＋トッピング）から材料の所要量を出し、在庫と比べて不足と発注数を出す。
import type { ProductionPlan } from "./production";
import { allMaterials, findMaterial, findTopping } from "./catalog";

export interface MaterialRequirement {
  materialId: string;
  name: string;
  /** 材料の単位（kg・L・個） */
  unit: string;
  /** 必要な重さ kg */
  needKg: number;
  /** 必要な量（材料の単位。L の油なら kg ÷ 0.91） */
  needUnits: number;
  /** どの生地・トッピングで使うか */
  uses: { from: "dough" | "topping"; id: string; kg: number }[];
  /** 発注しない材料（水など） */
  noPurchase: boolean;
}

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/** 製造計画（何日分でも）から材料の所要量を合計する */
export function materialRequirements(plans: ProductionPlan[]): MaterialRequirement[] {
  const map = new Map<string, MaterialRequirement>();
  const add = (materialId: string, kg: number, from: "dough" | "topping", id: string) => {
    if (kg <= 0) return;
    const m = findMaterial(materialId);
    const r = map.get(materialId) ?? {
      materialId, name: m?.name ?? materialId, unit: m?.unit ?? "kg", needKg: 0, needUnits: 0, uses: [], noPurchase: m?.noPurchase ?? false,
    };
    r.needKg += kg;
    const u = r.uses.find((x) => x.from === from && x.id === id);
    if (u) u.kg += kg;
    else r.uses.push({ from, id, kg });
    map.set(materialId, r);
  };
  for (const p of plans) {
    for (const d of p.doughs) for (const i of d.ingredients) add(i.materialId, i.kg, "dough", d.doughId);
    for (const t of p.toppings) {
      const tp = findTopping(t.toppingId);
      for (const i of tp?.items ?? []) add(i.materialId, (i.gramsPerPiece * t.pieces) / 1000, "topping", t.toppingId);
    }
  }
  const order = allMaterials().map((m) => m.id);
  return [...map.values()]
    .map((r) => ({
      ...r,
      needKg: round(r.needKg),
      needUnits: round(r.needKg / (findMaterial(r.materialId)?.kgPerUnit ?? 1)),
      uses: r.uses.map((u) => ({ ...u, kg: round(u.kg) })),
    }))
    .sort((a, b) => order.indexOf(a.materialId) - order.indexOf(b.materialId));
}

export interface MaterialShortage {
  materialId: string;
  name: string;
  unit: string;
  supplierId: string;
  needUnits: number;
  stock: number;
  safetyStock: number;
  /** 不足 = 必要量 + 安全在庫 − 在庫（0 以下なら発注しない） */
  shortUnits: number;
  /** 発注する数（25kg袋 × 3 なら 3） */
  orderPacks: number;
  /** 発注する量（材料の単位） */
  orderUnits: number;
  orderUnitLabel: string;
  /** 使ったあとに残る見込み（在庫 + 発注 − 必要量） */
  afterStock: number;
}

export interface ShortageOptions {
  /** 在庫を上書き（棚卸の結果など）。materialId → 量（材料の単位） */
  stock?: Record<string, number>;
  /** 安全在庫を見ない（ちょうど足りる分だけ発注する） */
  ignoreSafetyStock?: boolean;
}

/** 在庫と比べて不足と発注数を出す（発注しない材料＝水などは除く） */
export function materialShortages(reqs: MaterialRequirement[], opts: ShortageOptions = {}): MaterialShortage[] {
  return reqs
    .filter((r) => !r.noPurchase)
    .map((r) => {
      const m = findMaterial(r.materialId);
      const stock = opts.stock?.[r.materialId] ?? m?.stock ?? 0;
      const safety = opts.ignoreSafetyStock ? 0 : (m?.safetyStock ?? 0);
      const short = round(r.needUnits + safety - stock);
      const packSize = m?.orderUnit ?? 1;
      const orderPacks = short > 0 ? Math.ceil(round(short / packSize, 6)) : 0;
      const orderUnits = round(orderPacks * packSize);
      return {
        materialId: r.materialId,
        name: r.name,
        unit: r.unit,
        supplierId: m?.supplierId ?? "",
        needUnits: r.needUnits,
        stock,
        safetyStock: safety,
        shortUnits: Math.max(0, short),
        orderPacks,
        orderUnits,
        orderUnitLabel: m?.orderUnitLabel ?? "",
        afterStock: round(stock + orderUnits - r.needUnits),
      };
    });
}
