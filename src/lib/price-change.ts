// 材料の値上げ → 原価・粗利 → 売値の見直し → 取引先へのお知らせ（作者 11/7 担当者）。
// 1. 仕入先の FAX・メールの「値上げのお知らせ」を読む（price-change-reader.ts）→ 下書き
// 2. 人が OK → 材料の原価に反映（前の値段は costHistory に残す）
// 3. その材料を使う商品の原価と粗利率の 前 → 後。線（初期 10%）を切る商品は「見直しが必要」
// 4. 人が新しい卸価格と、いつからを決める → 取引先へのお知らせの下書き（/notices。送るのは今の送信の鍵の決まりのまま）
import "server-only";
import { randomUUID } from "node:crypto";
import type { Masters } from "@/data/types";
import { productCost, type ProductCost } from "@/lib/cost";
import { withMasters } from "@/lib/catalog";
import { kvGet, kvSet } from "@/lib/db/sqlite";
import { getMaster, upsertMasters } from "@/lib/db/masters";
import { nowIso } from "@/lib/clock";

export interface PriceChangeItem {
  materialId: string;
  name: string;
  unit: string;
  /** 1単位の原価（円）: 前 → 後 */
  oldCost: number;
  newCost: number;
}

export interface PriceDecision {
  productId: string;
  name: string;
  oldPrice: number;
  newPrice: number;
}

export interface PriceChange {
  id: string;
  supplierId: string;
  supplierName: string;
  /** いつから（YYYY-MM-DD） */
  effectiveDate: string;
  items: PriceChangeItem[];
  /** 元の FAX・メール */
  source?: { kind: "fax" | "email" | "manual"; id?: string; label?: string };
  reason?: string;
  status: "draft" | "applied";
  createdAt: string;
  appliedBy?: string;
  appliedAt?: string;
  /** 売値の見直し（人が決めた新しい卸価格） */
  decisions?: PriceDecision[];
  priceFrom?: string;
  noticeId?: string;
}

export interface ProductImpact {
  productId: string;
  name: string;
  price: number;
  costBefore: number;
  costAfter: number;
  rateBefore: number;
  rateAfter: number;
  /** 線を切った（見直しが必要） */
  belowLine: boolean;
}

const KEY = "price_changes";
const LINE_KEY = "margin_line";
export const listPriceChanges = (): PriceChange[] => (kvGet<PriceChange[]>(KEY) ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const getPriceChange = (id: string) => listPriceChanges().find((c) => c.id === id);
const save = (c: PriceChange) => kvSet(KEY, [c, ...(kvGet<PriceChange[]>(KEY) ?? []).filter((x) => x.id !== c.id)]);

/** 粗利率の線（%）。初期 10% */
export const marginLine = (): number => kvGet<number>(LINE_KEY) ?? 10;
export function setMarginLine(pct: number) {
  if (!(pct >= 0 && pct <= 90)) throw new Error("0〜90 の数で入れてください");
  kvSet(LINE_KEY, Math.round(pct * 10) / 10);
}

export function createPriceChange(input: Omit<PriceChange, "id" | "status" | "createdAt">): PriceChange {
  if (!input.items.length) throw new Error("値上げする材料がありません");
  const c: PriceChange = { ...input, id: `PC-${randomUUID().slice(0, 8)}`, status: "draft", createdAt: nowIso() };
  save(c);
  return c;
}

/** 値上げで原価が上がる商品（自社製造でその材料を使う物）。前 → 後。純関数（マスタを渡す） */
export function priceImpact(items: PriceChangeItem[], m: Masters, linePct: number, applied = false): ProductImpact[] {
  const ids = new Set(items.map((i) => i.materialId));
  const doughs = new Set(m.recipeItems.filter((r) => ids.has(r.materialId)).map((r) => r.doughId));
  const tops = new Set(m.toppingItems.filter((t) => ids.has(t.materialId)).map((t) => t.toppingId));
  const hit = m.products.filter((p) => p.active !== false && p.kind === "make" && ((p.doughId && doughs.has(p.doughId)) || (p.toppingId && tops.has(p.toppingId))));
  const withCost = (cost: (id: string) => number) => ({ ...m, materials: m.materials.map((x) => (ids.has(x.id) ? { ...x, unitCost: cost(x.id) } : x)) });
  const before = applied ? withCost((id) => items.find((i) => i.materialId === id)!.oldCost) : m;
  const after = withCost((id) => items.find((i) => i.materialId === id)!.newCost);
  const cost = (mm: Masters, id: string): ProductCost => withMasters(mm, () => productCost(id));
  return hit
    .map((p) => {
      const b = cost(before, p.id);
      const a = cost(after, p.id);
      return {
        productId: p.id,
        name: p.name,
        price: p.price,
        costBefore: b.cost,
        costAfter: a.cost,
        rateBefore: Math.round(b.grossRate * 1000) / 10,
        rateAfter: Math.round(a.grossRate * 1000) / 10,
        belowLine: a.grossRate * 100 < linePct,
      };
    })
    .filter((x) => x.costAfter > x.costBefore)
    .sort((x, y) => Number(y.belowLine) - Number(x.belowLine) || x.rateAfter - y.rateAfter);
}

/** 人が OK → 材料マスタの原価を新しい値に（前の値段は costHistory に残す） */
export async function applyPriceChange(id: string, who: string): Promise<PriceChange> {
  if (!who.trim()) throw new Error("OK する人を選んでください");
  const c = getPriceChange(id);
  if (!c) throw new Error("値上げの記録が見つかりません");
  if (c.status === "applied") throw new Error("もう反映しました");
  const rows = [];
  for (const it of c.items) {
    const row = await getMaster<{ id: string; unitCost?: number; costHistory?: { until: string; cost: number }[] }>("materials", it.materialId);
    if (!row) throw new Error(`材料 ${it.name} がマスタにありません`);
    rows.push({ ...row, unitCost: it.newCost, costHistory: [...(row.costHistory ?? []), { until: c.effectiveDate, cost: row.unitCost ?? it.oldCost }] });
  }
  await upsertMasters("materials", rows, who);
  const next: PriceChange = { ...c, status: "applied", appliedBy: who, appliedAt: nowIso() };
  save(next);
  return next;
}

/** 売値の見直しを決める（新しい卸価格といつから）。保存だけ */
export function decidePrices(id: string, decisions: PriceDecision[], from: string): PriceChange {
  const c = getPriceChange(id);
  if (!c) throw new Error("値上げの記録が見つかりません");
  const ds = decisions.filter((d) => d.newPrice > 0 && d.newPrice !== d.oldPrice);
  if (!ds.length) throw new Error("新しい卸価格を1つ以上入れてください");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("いつからを入れてください");
  const next: PriceChange = { ...c, decisions: ds, priceFrom: from };
  save(next);
  return next;
}

export function linkNotice(id: string, noticeId: string) {
  const c = getPriceChange(id);
  if (c) save({ ...c, noticeId });
}
