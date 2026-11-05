// 製造の実績（商品ごとの作った数）から、使った材料・包材の量を出す（純粋な計算。保存しない）。
// 材料: レシピ × 製造数（ロス込み）＝③の doughBatch と materialRequirements をそのまま使う。トッピングも同じ。
// 包材: 商品の包材（productPackaging）の「1個／1包・1袋／1ケース あたりの数」× 作った数。
import type { Masters } from "@/data/types";
import { findProduct, withMasters } from "@/lib/catalog";
import { materialRequirements } from "@/lib/materials";
import { doughBatch, type DoughItem, type ProductionPlan } from "@/lib/production";

export interface MadeItem {
  productId: string;
  pieces: number;
}

export interface Usage {
  /** 材料（在庫の単位: kg・L・個） */
  materials: { id: string; name: string; unit: string; qty: number }[];
  /** 包材（在庫の単位） */
  packaging: { id: string; name: string; unit: string; qty: number }[];
  /** 計算できなかった商品など */
  warnings: string[];
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function productionUsage(masters: Masters, made: MadeItem[]): Usage {
  return withMasters(masters, () => {
    const warnings: string[] = [];
    const byDough = new Map<string, DoughItem[]>();
    const toppings: ProductionPlan["toppings"] = [];
    for (const m of made) {
      if (!(m.pieces > 0)) continue;
      const p = findProduct(m.productId);
      const spec = p?.spec;
      if (!p || !spec || spec.kind !== "make") continue; // 仕入品・包み直しは材料を使わない（包材は下で数える）
      const items = byDough.get(spec.doughId) ?? [];
      items.push({ productId: p.id, name: p.name, pieces: m.pieces, doughGram: spec.doughGram, ...(spec.toppingId ? { toppingId: spec.toppingId } : {}) });
      byDough.set(spec.doughId, items);
      if (spec.toppingId) toppings.push({ productId: p.id, toppingId: spec.toppingId, pieces: m.pieces });
    }
    const doughs = [...byDough].flatMap(([doughId, items]) => {
      try {
        return [doughBatch(doughId, items)];
      } catch (e) {
        warnings.push(e instanceof Error ? e.message : String(e));
        return [];
      }
    });
    const plan: ProductionPlan = { date: "", lines: [], doughs, toppings, repack: [], warnings: [] };
    const materials = materialRequirements([plan])
      .filter((r) => !r.noPurchase && r.needUnits > 0)
      .map((r) => ({ id: r.materialId, name: r.name, unit: r.unit, qty: r.needUnits }));

    const pk = new Map<string, number>();
    for (const m of made) {
      if (!(m.pieces > 0)) continue;
      const prod = masters.products.find((p) => p.id === m.productId);
      for (const x of masters.productPackaging.filter((y) => y.productId === m.productId)) {
        const per = x.per === "piece" ? 1 : x.per === "pack" ? Math.max(1, prod?.bagSize ?? 1) : Math.max(1, prod?.caseSize ?? 1);
        pk.set(x.packagingId, (pk.get(x.packagingId) ?? 0) + x.quantity * Math.ceil(m.pieces / per));
      }
    }
    const packaging = [...pk].map(([id, qty]) => {
      const k = masters.packaging.find((p) => p.id === id);
      return { id, name: k?.name ?? id, unit: k?.unit ?? "枚", qty: round(qty) };
    });
    return { materials, packaging, warnings };
  });
}
