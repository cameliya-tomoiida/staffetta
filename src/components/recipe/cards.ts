// 生地カード（レシピを1枚＝1生地で見せる）のための形。マスタと、製造計画の生地の量（③の DoughBatchPlan）から作る。
// 計算は足し算・割り算だけ（生地 kg → 粉 kg → 材料 g は ③の doughBatch と同じ式）。画面は表示するだけ。
import type { Masters } from "@/data/types";
import type { DoughBatchPlan } from "@/lib/production";
import { isFlourName } from "@/lib/masters/recipe";

export interface DoughCardItem {
  materialId: string;
  name: string;
  percent: number;
  /** 粉（ベーカーズ％の基準。名前に「粉」が入る材料。粉乳は除く） */
  flour: boolean;
  /** ミキサー1回分の g */
  batchG: number;
  /** 製造計画の日のぶんの kg（計画が無ければ無し） */
  planKg?: number;
}

export interface DoughCardStep {
  seq: number;
  name: string;
  /** 段取り＋待ち（分） */
  minutes: number;
  /** ミキサー1回ごと（分） */
  perBatch: number;
  people: number;
  equipment?: string;
  prevDay: boolean;
  ccp: boolean;
  note?: string;
}

export interface DoughCard {
  id: string;
  name: string;
  line: string;
  lineName: string;
  lossRate: number;
  mixerMaxKg: number;
  /** 1回分の g を出すときの生地 kg（計画があればその日の1回分、無ければミキサーの上限） */
  batchKg: number;
  totalPercent: number;
  flourPercent: number;
  items: DoughCardItem[];
  steps: DoughCardStep[];
  products: { id: string; name: string; doughGram?: number }[];
  plan?: { date: string; pieces: number; doughKg: number; flourKg: number; batches: number; batchKg: number };
  warnings: string[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** マスタから生地カードを作る。plans を渡すと「その日のぶん」も入る（便で分かれた生地は足し合わせる） */
export function doughCards(m: Masters, plans?: { date: string; doughs: DoughBatchPlan[] }): DoughCard[] {
  const matName = (id: string) => m.materials.find((x) => x.id === id)?.name ?? id;
  const live = <T extends { active?: boolean; disabled?: boolean }>(x: T) => x.active !== false && !x.disabled;
  return m.doughs.filter((d) => live(d as never)).map((d) => {
    const steps = m.steps.filter((s) => s.doughId === d.id && live(s as never)).sort((a, b) => a.seq - b.seq);
    const mixer = steps.map((s) => m.equipment.find((e) => e.id === s.equipmentId)).find((e) => e?.kind === "mixer");
    const mixerMaxKg = d.mixerMaxKg ?? mixer?.maxBatchKg ?? 50;
    const rows = m.recipeItems.filter((x) => x.doughId === d.id && live(x as never));
    const totalPercent = r2(rows.reduce((s, x) => s + (Number(x.percent) || 0), 0));
    const flourPercent = r2(rows.filter((x) => isFlourName(matName(x.materialId))).reduce((s, x) => s + (Number(x.percent) || 0), 0));

    const mine = plans?.doughs.filter((b) => b.doughId === d.id) ?? [];
    const plan = mine.length
      ? {
          date: plans!.date,
          pieces: mine.reduce((s, b) => s + b.pieces, 0),
          doughKg: r1(mine.reduce((s, b) => s + b.doughKg, 0)),
          flourKg: r1(mine.reduce((s, b) => s + b.flourKg, 0)),
          batches: mine.reduce((s, b) => s + b.batches, 0),
          batchKg: r1(Math.max(...mine.map((b) => b.batchKg))),
        }
      : undefined;
    const batchKg = plan?.batchKg || mixerMaxKg;
    const flourKgPerBatch = totalPercent > 0 ? batchKg / (totalPercent / 100) : 0;
    const planKg = (id: string) => {
      const kg = mine.reduce((s, b) => s + (b.ingredients.find((i) => i.materialId === id)?.kg ?? 0), 0);
      return mine.length ? r2(kg) : undefined;
    };

    const warnings: string[] = [];
    if (!rows.length) warnings.push("配合がまだありません");
    else if (!flourPercent) warnings.push("粉（名前に「粉」が入る材料）がありません");
    else if (Math.abs(flourPercent - 100) > 0.01) warnings.push(`粉の合計が ${flourPercent}% です（100 にします）`);

    return {
      id: d.id,
      name: d.name,
      line: d.line,
      lineName: m.lines.find((l) => l.id === d.line)?.name ?? (d.line === "pizza" ? "ピザ" : "パン"),
      lossRate: d.lossRate,
      mixerMaxKg,
      batchKg,
      totalPercent,
      flourPercent,
      items: rows.map((x) => ({
        materialId: x.materialId,
        name: matName(x.materialId),
        percent: Number(x.percent) || 0,
        flour: isFlourName(matName(x.materialId)),
        batchG: Math.round((flourKgPerBatch * (Number(x.percent) || 0) * 1000) / 100),
        ...(planKg(x.materialId) !== undefined ? { planKg: planKg(x.materialId) } : {}),
      }))
        // 粉（％の基準）を上に。ほかは入れた順のまま
        .sort((a, b) => Number(b.flour) - Number(a.flour)),
      steps: steps.map((s) => ({
        seq: s.seq,
        name: s.name,
        minutes: (s.setupMinutes ?? 0) + (s.waitMinutes ?? 0),
        perBatch: s.minutesPerBatch ?? 0,
        people: s.people,
        ...(s.equipmentId ? { equipment: m.equipment.find((e) => e.id === s.equipmentId)?.name ?? s.equipmentId } : {}),
        prevDay: !!s.prevDay,
        ccp: !!s.ccp,
        ...(s.note ? { note: s.note } : {}),
      })),
      products: m.products
        .filter((p) => p.doughId === d.id && live(p as never))
        .map((p) => ({ id: p.id, name: p.name, ...(p.doughGram ? { doughGram: p.doughGram } : {}) })),
      ...(plan ? { plan } : {}),
      warnings,
    };
  });
}
