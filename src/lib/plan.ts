// 受注 → 集計 → 製造計画・工程表 → 材料所要量・発注 の計算。
// ここは全部ふつうの計算（AIは使わない）。同じ入力なら必ず同じ結果になる。
import {
  doughById, doughs, doughWaterPercent, materialById, materials, productById, products,
  supplierById, type Dough, type Line, type StepKey,
} from "@/data/master";
import type { Order } from "@/data/types";

export interface ProductTotal {
  productId: string;
  pieces: number;
  customers: { customerId: string; pieces: number }[];
}

/** 確定済みの注文だけを、納品日ごと・商品ごとに合計する（入口がFAXでもLINEでも同じ） */
export function totalsByProduct(orders: Order[], date: string): ProductTotal[] {
  const map = new Map<string, ProductTotal>();
  for (const o of orders.filter((o) => o.status === "confirmed" && o.deliveryDate === date)) {
    for (const l of o.lines) {
      const t = map.get(l.productId) ?? { productId: l.productId, pieces: 0, customers: [] };
      t.pieces += l.pieces;
      const c = t.customers.find((c) => c.customerId === o.customerId);
      if (c) c.pieces += l.pieces;
      else t.customers.push({ customerId: o.customerId, pieces: l.pieces });
      map.set(l.productId, t);
    }
  }
  const order = products.map((p) => p.id);
  return [...map.values()].sort((a, b) => order.indexOf(a.productId) - order.indexOf(b.productId));
}

export function deliveryDates(orders: Order[]): string[] {
  return [...new Set(orders.filter((o) => o.status === "confirmed").map((o) => o.deliveryDate))].sort();
}

/** 仕入品: 仕入先の入数でしか買えないものを袋数に直す（例: 65個 → 6個入×11袋・余り1） */
export function buyPlan(totals: ProductTotal[]) {
  return totals
    .map((t) => ({ t, p: productById(t.productId)! }))
    .filter(({ p }) => p.source === "buy")
    .map(({ t, p }) => {
      const pack = p.packSize ?? 1;
      const packs = Math.ceil(t.pieces / pack);
      return { productId: p.id, supplierId: p.supplierId!, pieces: t.pieces, packSize: pack, packs, extra: packs * pack - t.pieces };
    });
}

export interface DoughBatch {
  dough: Dough;
  items: { productId: string; pieces: number; pieceGram: number }[];
  /** 分割に必要な生地量（g） */
  netGram: number;
  /** ロス込みで仕込む生地量（g） */
  doughGram: number;
  flourKg: number;
  ingredients: { materialId: string; kg: number }[];
  waterKg: number;
}

export function doughPlan(totals: ProductTotal[]): DoughBatch[] {
  const batches: DoughBatch[] = [];
  for (const d of doughs) {
    const items = totals
      .map((t) => ({ t, p: productById(t.productId)! }))
      .filter(({ p }) => p.source === "make" && p.doughId === d.id)
      .map(({ t, p }) => ({ productId: p.id, pieces: t.pieces, pieceGram: p.pieceGram! }));
    if (!items.length) continue;
    const netGram = items.reduce((s, i) => s + i.pieces * i.pieceGram, 0);
    const doughGram = netGram / (1 - d.lossRate);
    const totalPercent = d.ingredients.reduce((s, i) => s + i.percent, 0) + (doughWaterPercent[d.id] ?? 0);
    const flourKg = doughGram / 1000 / (totalPercent / 100);
    batches.push({
      dough: d,
      items,
      netGram,
      doughGram,
      flourKg,
      ingredients: d.ingredients.map((i) => ({ materialId: i.materialId, kg: (flourKg * i.percent) / 100 })),
      waterKg: (flourKg * (doughWaterPercent[d.id] ?? 0)) / 100,
    });
  }
  return batches;
}

export interface ScheduleRow {
  doughId: string;
  line: Line;
  steps: { key: StepKey; start: number; end: number }[]; // 分（0:00からの経過）
}

/** 工程表: ラインごとにミキサーを1台として、生地を順番に仕込む */
export function schedule(batches: DoughBatch[], startMinutes = { bread: 4 * 60, pizza: 6 * 60 }): ScheduleRow[] {
  const nextMix: Record<Line, number> = { ...startMinutes };
  return batches.map((b) => {
    let t = nextMix[b.dough.line];
    const steps = b.dough.steps.map((s) => {
      // 分割・成形・焼成は量に応じて少し伸ばす（10kgごとに+20%）
      const scale = ["divide", "shape", "pack"].includes(s.key) ? 1 + Math.floor(b.doughGram / 10000) * 0.2 : 1;
      const step = { key: s.key, start: t, end: t + Math.round(s.minutes * scale) };
      t = step.end;
      return step;
    });
    nextMix[b.dough.line] = steps[0].end; // 次の生地はミキシングが空いたら
    return { doughId: b.dough.id, line: b.dough.line, steps };
  });
}

export interface MaterialNeed {
  materialId: string;
  needKg: number;
  stock: number;
  safetyStock: number;
  orderUnits: number;
  orderQty: number;
}

export function materialNeeds(batchesPerDay: DoughBatch[][]): MaterialNeed[] {
  const need = new Map<string, number>();
  for (const batches of batchesPerDay)
    for (const b of batches) for (const i of b.ingredients) need.set(i.materialId, (need.get(i.materialId) ?? 0) + i.kg);
  return materials
    .filter((m) => need.has(m.id))
    .map((m) => {
      const n = need.get(m.id)!;
      const short = n + m.safetyStock - m.stock;
      const orderUnits = short > 0 ? Math.ceil(short / m.orderUnit) : 0;
      return { materialId: m.id, needKg: n, stock: m.stock, safetyStock: m.safetyStock, orderUnits, orderQty: orderUnits * m.orderUnit };
    });
}

/** 仕入先ごとの発注書（材料＋仕入品） */
export function purchaseOrders(needs: MaterialNeed[], buys: ReturnType<typeof buyPlan>) {
  const bySupplier = new Map<string, { label: string; qty: string }[]>();
  for (const n of needs.filter((n) => n.orderUnits > 0)) {
    const m = materialById(n.materialId)!;
    const arr = bySupplier.get(m.supplierId) ?? [];
    arr.push({ label: m.name, qty: `${m.orderUnitLabel} × ${n.orderUnits}` });
    bySupplier.set(m.supplierId, arr);
  }
  for (const b of buys) {
    const p = productById(b.productId)!;
    const arr = bySupplier.get(b.supplierId) ?? [];
    arr.push({ label: p.name, qty: b.packSize > 1 ? `${b.packSize}個入 × ${b.packs}袋` : `${b.packs}個` });
    bySupplier.set(b.supplierId, arr);
  }
  return [...bySupplier.entries()].map(([sid, lines]) => ({ supplier: supplierById(sid)!, lines }));
}

export const fmtTime = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
export const doughName = (id: string) => doughById(id)?.name ?? id;
