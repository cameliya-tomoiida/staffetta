// 食パンのまとめ（作者 11/6 工場長の話）。純関数。
// 同じ食パンでも届け先で 1枚食・2枚食・3枚食（個包装）、3斤を 6・8・10枚切り、喫茶店向けの 4枚切り（手切り）などに変わる。
// 製造の側に「もとの食パンを合計何本焼くか」と「切り方ごとに何個（何本ぶん）」を出す。
// 商品のマスタの もとの食パン（loafName）・切り方（cutLabel）・1つに使う本数（loavesPerUnit）から。
import type { ProductMaster } from "@/data/types";

export interface BreadCut {
  productId: string;
  name: string;
  cut: string;
  /** 注文の数（売る単位） */
  units: number;
  unit: string;
  /** もとの食パン何本ぶん */
  loaves: number;
}

export interface BreadLoaf {
  loaf: string;
  /** 焼く本数（切り上げ） */
  loaves: number;
  /** ちょうどの本数（端数あり） */
  exact: number;
  cuts: BreadCut[];
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function breadSummary(totals: { productId: string; pieces: number }[], products: Pick<ProductMaster, "id" | "name" | "unit" | "loafName" | "cutLabel" | "loavesPerUnit">[]): BreadLoaf[] {
  const by = new Map<string, BreadCut[]>();
  for (const t of totals) {
    const p = products.find((x) => x.id === t.productId);
    if (!p?.loafName || !(p.loavesPerUnit && p.loavesPerUnit > 0) || t.pieces <= 0) continue;
    const cut: BreadCut = { productId: p.id, name: p.name, cut: p.cutLabel || p.name, units: t.pieces, unit: p.unit, loaves: r2(t.pieces * p.loavesPerUnit) };
    by.set(p.loafName, [...(by.get(p.loafName) ?? []), cut]);
  }
  return [...by.entries()].map(([loaf, cuts]) => {
    const exact = cuts.reduce((s, c) => s + c.units * (products.find((p) => p.id === c.productId)!.loavesPerUnit ?? 0), 0);
    return { loaf, loaves: Math.ceil(exact - 1e-9), exact: r2(exact), cuts: cuts.sort((a, b) => b.loaves - a.loaves) };
  });
}
