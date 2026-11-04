// 棚卸（3か月に1回）で在庫を実数に合わせ、理論の使用量との差から、生地ごとのロス率の「補正案」を出す。
//
// 大事な決まり: この関数はロス率を書き換えない。補正案を返すだけ。
// 人が見て承認した分だけを approveLossProposals で「使うロス率」にし、
// planProduction(..., { lossRates }) に渡して初めて計算に入る。
//
// 式（README にも書く）:
//   実際の使用量 A_m = 期首在庫 + 期間中の入荷 − 棚卸の実数        （材料 m ごと）
//   理論の使用量 T_m = 期間中の製造計画から出した使用量（今のロス率込み）
//   材料の比 r_m = A_m ÷ T_m
//   生地の比 R_d = Σ(w_dm × r_m) ÷ Σ w_dm   （w_dm = 生地 d で使う材料 m の理論kg。水・発注しない材料は除く）
//   補正案 L' = 1 − (1 − L) ÷ R_d            （L = 今のロス率）
//   ※ 実際の生地量 = 正味 ÷ (1 − L') = 理論の生地量 × R_d となるロス率
import type { Order } from "@/data/types";
import { totalsForDate } from "./aggregate";
import { findDough, findMaterial, findTopping } from "./catalog";
import { planProduction, type ProductionOptions, type ProductionPlan } from "./production";
import { addDays } from "./purchase";

export interface StockState {
  materialId: string;
  /** 期首（前回の棚卸）の在庫（材料の単位） */
  startStock: number;
  /** 期間中に入荷した量（材料の単位） */
  received: number;
}

export interface StocktakePeriod {
  from: string; // YYYY-MM-DD
  to: string;
  /** 期間中の製造計画（理論の使用量の元）。theoreticalPlans で作れる */
  plans: ProductionPlan[];
}

export interface StockAdjustment {
  materialId: string;
  name: string;
  unit: string;
  startStock: number;
  received: number;
  /** 理論の使用量 */
  theoretical: number;
  /** 帳簿の在庫 = 期首 + 入荷 − 理論の使用量 */
  bookStock: number;
  /** 棚卸の実数 */
  counted: number;
  /** 差 = 実数 − 帳簿（マイナス = 帳簿より少ない = 多く使った・ロスが多い） */
  diff: number;
  /** 実際の使用量 = 期首 + 入荷 − 実数 */
  actualUsage: number;
  /** 実際 ÷ 理論（理論が0なら undefined） */
  ratio?: number;
}

export interface LossProposal {
  doughId: string;
  name: string;
  /** 今のロス率 */
  currentLoss: number;
  /** 補正案 */
  suggestedLoss: number;
  /** "up" ロスを上げる / "down" 下げる / "same" ほぼ同じ（±0.5%未満）なので変えない */
  change: "up" | "down" | "same";
  /** 数え間違いなどの可能性があり、人がよく確認すべきとき true（比が 0.8 未満か 1.3 超え） */
  needsCheck: boolean;
  basis: {
    /** 生地の比 R_d */
    ratio: number;
    /** 計算に使った材料 */
    materials: { materialId: string; name: string; weightKg: number; ratio: number }[];
    formula: string;
    /** やさしい日本語の説明 */
    note: string;
  };
}

export interface StocktakeResult {
  period: { from: string; to: string };
  adjustments: StockAdjustment[];
  /** 棚卸の実数に合わせた新しい在庫（materialId → 量）。保存は呼ぶ側 */
  newStock: Record<string, number>;
  proposals: LossProposal[];
  warnings: string[];
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
const MAX_LOSS = 0.3;

/** 期間（両端を含む）の毎日の製造計画を作る（理論の使用量の元） */
export function theoreticalPlans(orders: Order[], from: string, to: string, opts?: ProductionOptions): ProductionPlan[] {
  const plans: ProductionPlan[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) plans.push(planProduction(totalsForDate(orders, d), opts));
  return plans;
}

/** 製造計画から、材料ごとの理論の使用量（材料の単位）と、生地ごとの材料kg */
function theoreticalUsage(plans: ProductionPlan[]) {
  const total = new Map<string, number>();
  const byDough = new Map<string, Map<string, number>>(); // doughId → materialId → kg
  const loss = new Map<string, { sum: number; kg: number }>(); // 生地ごとのロス率（量で重み付け）
  const add = (materialId: string, kg: number) => {
    const m = findMaterial(materialId);
    total.set(materialId, (total.get(materialId) ?? 0) + kg / (m?.kgPerUnit || 1));
  };
  for (const p of plans) {
    for (const d of p.doughs) {
      const mm = byDough.get(d.doughId) ?? new Map<string, number>();
      for (const i of d.ingredients) {
        add(i.materialId, i.kg);
        mm.set(i.materialId, (mm.get(i.materialId) ?? 0) + i.kg);
      }
      byDough.set(d.doughId, mm);
      const l = loss.get(d.doughId) ?? { sum: 0, kg: 0 };
      l.sum += d.lossRate * d.doughKg;
      l.kg += d.doughKg;
      loss.set(d.doughId, l);
    }
    for (const t of p.toppings)
      for (const i of findTopping(t.toppingId)?.items ?? []) add(i.materialId, (i.gramsPerPiece * t.pieces) / 1000);
  }
  return { total, byDough, loss };
}

/**
 * 棚卸の結果を受けて、在庫を実数に合わせ、ロス率の補正案を返す（ロス率は書き換えない）。
 * @param materials 材料ごとの 期首在庫・期間中の入荷
 * @param counted 棚卸の実数
 * @param period 期間と、その間の製造計画
 */
export function applyStocktake(materials: StockState[], counted: { materialId: string; qty: number }[], period: StocktakePeriod): StocktakeResult {
  const warnings: string[] = [];
  const { total, byDough, loss } = theoreticalUsage(period.plans);
  const countedMap = new Map(counted.map((c) => [c.materialId, c.qty]));

  const adjustments: StockAdjustment[] = [];
  const newStock: Record<string, number> = {};
  for (const s of materials) {
    const m = findMaterial(s.materialId);
    if (m?.noPurchase) continue;
    const c = countedMap.get(s.materialId);
    if (c === undefined) {
      warnings.push(`${m?.name ?? s.materialId}: 棚卸の数がありません（補正に使いません）`);
      continue;
    }
    const theoretical = r3(total.get(s.materialId) ?? 0);
    const bookStock = r3(s.startStock + s.received - theoretical);
    const actualUsage = r3(s.startStock + s.received - c);
    if (actualUsage < 0) warnings.push(`${m?.name ?? s.materialId}: 実数が 期首＋入荷 より多い（入荷の記録もれ？）`);
    adjustments.push({
      materialId: s.materialId, name: m?.name ?? s.materialId, unit: m?.unit ?? "kg",
      startStock: s.startStock, received: s.received, theoretical, bookStock, counted: c,
      diff: r3(c - bookStock), actualUsage, ratio: theoretical > 0 ? r3(actualUsage / theoretical) : undefined,
    });
    newStock[s.materialId] = c;
  }
  for (const c of counted) if (!(c.materialId in newStock) && !findMaterial(c.materialId)?.noPurchase) newStock[c.materialId] = c.qty;

  const ratioOf = new Map(adjustments.filter((a) => a.ratio !== undefined).map((a) => [a.materialId, a.ratio!]));
  const proposals: LossProposal[] = [];
  for (const [doughId, mats] of byDough) {
    const used = [...mats.entries()]
      .filter(([id]) => !findMaterial(id)?.noPurchase && ratioOf.has(id))
      .map(([id, kg]) => ({ materialId: id, name: findMaterial(id)?.name ?? id, weightKg: r3(kg), ratio: ratioOf.get(id)! }));
    const name = findDough(doughId)?.name ?? doughId;
    if (!used.length) {
      warnings.push(`${name}: 棚卸の数がある材料が無いので、補正案を出せません`);
      continue;
    }
    const w = used.reduce((s, x) => s + x.weightKg, 0);
    const R = r3(used.reduce((s, x) => s + x.weightKg * x.ratio, 0) / w);
    const l = loss.get(doughId)!;
    const current = r3(l.kg > 0 ? l.sum / l.kg : (findDough(doughId)?.lossRate ?? 0));
    let suggested = r3(Math.min(MAX_LOSS, Math.max(0, 1 - (1 - current) / R)));
    let change: LossProposal["change"] = suggested > current ? "up" : "down";
    if (Math.abs(suggested - current) < 0.005) {
      suggested = current;
      change = "same";
    }
    const needsCheck = R < 0.8 || R > 1.3;
    if (needsCheck) warnings.push(`${name}: 実際と理論の差が大きい（${R}倍）。数え間違い・入荷の記録もれがないか確認してください`);
    proposals.push({
      doughId, name, currentLoss: current, suggestedLoss: suggested, change, needsCheck,
      basis: {
        ratio: R,
        materials: used,
        formula: `L' = 1 − (1 − ${current}) ÷ ${R} = ${suggested}`,
        note:
          change === "same"
            ? `実際の使用量は理論の ${R}倍。ロス率 ${pct(current)} のままでよさそうです`
            : `実際の使用量は理論の ${R}倍。ロス率を ${pct(current)} → ${pct(suggested)} にすると合います`,
      },
    });
  }

  return { period: { from: period.from, to: period.to }, adjustments, newStock, proposals: proposals.sort((a, b) => a.doughId.localeCompare(b.doughId)), warnings };
}

export interface ApprovedLossRates {
  /** doughId → 使うロス率。planProduction(..., { lossRates }) に渡す */
  lossRates: Record<string, number>;
  approvedBy: string;
  approvedAt: string;
  /** 承認した補正案（根拠を残す） */
  approved: LossProposal[];
}

/**
 * 人が選んだ補正案だけを承認して「使うロス率」にする。
 * @param doughIds 承認する生地（画面でチェックを入れたもの）
 * @param current いま使っているロス率（前回承認した分）。承認しなかった生地はそのまま残す
 */
export function approveLossProposals(
  proposals: LossProposal[],
  doughIds: string[],
  who: string,
  at: string = new Date().toISOString(),
  current: Record<string, number> = {},
): ApprovedLossRates {
  if (!who.trim()) throw new Error("承認した人の名前が必要です");
  const approved = proposals.filter((p) => doughIds.includes(p.doughId) && p.change !== "same");
  const lossRates = { ...current };
  for (const p of approved) lossRates[p.doughId] = p.suggestedLoss;
  return { lossRates, approvedBy: who.trim(), approvedAt: at, approved };
}
