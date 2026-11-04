// 製造計画と工程表。
// 自社で作る商品の個数 → 生地kg（ロス率込み）→ ミキサー回数・材料kg、ライン（パン・ピザ）ごとの上限チェック、
// 工程の時間割（工程表）を出す。全部ふつうの計算で、同じ入力なら必ず同じ結果になる。
import { lineSettings, type Line, type ProcessKey } from "@/data/production";
import type { DayTotals } from "./aggregate";
import { findDough, findMaterial, findProduct, findTopping } from "./catalog";

export interface DoughItem {
  productId: string;
  name: string;
  pieces: number;
  /** 1個の生地 g（分割g） */
  doughGram: number;
  toppingId?: string;
}

export interface DoughIngredient {
  materialId: string;
  name: string;
  percent: number;
  kg: number;
}

export interface DoughBatchPlan {
  doughId: string;
  name: string;
  line: Line;
  items: DoughItem[];
  pieces: number;
  /** 分割に必要な生地 kg（ロスなし） */
  netKg: number;
  lossRate: number;
  /** ロス込みで仕込む生地 kg = netKg ÷ (1 − ロス率) */
  doughKg: number;
  /** 粉の合計 kg（ベーカーズ％の基準） */
  flourKg: number;
  /** ミキサーの回数 */
  batches: number;
  /** 1回あたりの生地 kg */
  batchKg: number;
  ingredients: DoughIngredient[];
}

export interface ToppingUse {
  productId: string;
  toppingId: string;
  pieces: number;
}

export interface RepackJob {
  productId: string;
  name: string;
  sourceProductId: string;
  slicesPerPack: number;
  packs: number;
}

export interface LinePlan {
  line: Line;
  name: string;
  pieces: number;
  /** その日の上限（なければ undefined） */
  cap?: number;
  /** 上限の理由（例: 「ピザクラスト 27cm がある日は 1,200枚」） */
  capReason?: string;
  /** 上限を超えた数（超えていなければ 0） */
  overBy: number;
  doughs: DoughBatchPlan[];
  warnings: string[];
}

export interface ProductionPlan {
  date: string;
  lines: LinePlan[];
  doughs: DoughBatchPlan[];
  toppings: ToppingUse[];
  /** 仕入れた食パンを切って包み直す作業 */
  repack: RepackJob[];
  warnings: string[];
}

export interface ProductionOptions {
  /** ラインの上限を上書きする（例: { pizza: 1500 }） */
  lineCaps?: Partial<Record<Line, number>>;
}

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
const fmtNum = (n: number) => n.toLocaleString("ja-JP");

/** 1日分の集計から製造計画を作る（自社製造の商品だけ） */
export function planProduction(day: DayTotals, opts: ProductionOptions = {}): ProductionPlan {
  const warnings: string[] = [];
  const byDough = new Map<string, DoughItem[]>();
  const toppings: ToppingUse[] = [];
  const repack: RepackJob[] = [];

  for (const t of day.products) {
    const spec = findProduct(t.productId)?.spec;
    if (!spec) {
      warnings.push(`${t.name}: 作り方・仕入れ方が未登録です`);
      continue;
    }
    if (spec.kind === "repack") {
      repack.push({ productId: t.productId, name: t.name, sourceProductId: spec.sourceProductId, slicesPerPack: spec.slicesPerPack, packs: t.pieces });
      continue;
    }
    if (spec.kind !== "make") continue;
    if (!findDough(spec.doughId)) {
      warnings.push(`${t.name}: 生地 ${spec.doughId} がありません`);
      continue;
    }
    byDough.set(spec.doughId, [
      ...(byDough.get(spec.doughId) ?? []),
      { productId: t.productId, name: t.name, pieces: t.pieces, doughGram: spec.doughGram, toppingId: spec.toppingId },
    ]);
    if (spec.toppingId) toppings.push({ productId: t.productId, toppingId: spec.toppingId, pieces: t.pieces });
  }

  const doughs: DoughBatchPlan[] = [...byDough.entries()].map(([doughId, items]) => doughBatch(doughId, items));

  const lines: LinePlan[] = (Object.keys(lineSettings) as Line[]).map((line) => {
    const ls = lineSettings[line];
    const lineDoughs = doughs.filter((d) => d.line === line);
    const pieces = lineDoughs.reduce((s, d) => s + d.pieces, 0);
    let cap = opts.lineCaps?.[line] ?? ls.dailyCap;
    let capReason = cap !== undefined ? `${ls.name}の1日の上限` : undefined;
    // 商品によっては、その商品がある日は上限が下がる（例: 27cm の日は 1,200枚）
    for (const d of lineDoughs)
      for (const it of d.items) {
        const s = findProduct(it.productId)?.spec;
        if (s?.kind === "make" && s.dailyCap !== undefined && (cap === undefined || s.dailyCap < cap)) {
          cap = s.dailyCap;
          capReason = `${it.name}がある日の上限`;
        }
      }
    const overBy = cap !== undefined ? Math.max(0, pieces - cap) : 0;
    const lw: string[] = [];
    if (overBy > 0) lw.push(`${ls.name} ${fmtNum(pieces)}個: ${capReason} ${fmtNum(cap!)}個を ${fmtNum(overBy)}個 超えています`);
    return { line, name: ls.name, pieces, cap, capReason, overBy, doughs: lineDoughs, warnings: lw };
  });

  return {
    date: day.date,
    lines,
    doughs,
    toppings,
    repack,
    warnings: [...warnings, ...lines.flatMap((l) => l.warnings)],
  };
}

/** 生地1種類分: 個数 → 生地kg（ロス込み）→ 粉kg → 材料kg（ベーカーズ％） */
export function doughBatch(doughId: string, items: DoughItem[]): DoughBatchPlan {
  const d = findDough(doughId);
  if (!d) throw new Error(`生地 ${doughId} がありません`);
  const pieces = items.reduce((s, i) => s + i.pieces, 0);
  const netKg = items.reduce((s, i) => s + (i.pieces * i.doughGram) / 1000, 0);
  const doughKg = netKg / (1 - d.lossRate);
  const totalPercent = d.items.reduce((s, i) => s + i.percent, 0);
  const flourKg = doughKg / (totalPercent / 100);
  const batches = doughKg > 0 ? Math.ceil(doughKg / d.mixerMaxKg) : 0;
  return {
    doughId,
    name: d.name,
    line: d.line,
    items,
    pieces,
    netKg: round(netKg),
    lossRate: d.lossRate,
    doughKg: round(doughKg),
    flourKg: round(flourKg),
    batches,
    batchKg: batches ? round(doughKg / batches) : 0,
    ingredients: d.items.map((i) => ({
      materialId: i.materialId,
      name: findMaterial(i.materialId)?.name ?? i.materialId,
      percent: i.percent,
      kg: round((flourKg * i.percent) / 100),
    })),
  };
}

// ───────── 工程表 ─────────

export interface ScheduleStep {
  key: ProcessKey;
  name: string;
  /** 0:00 からの分（前日の作業は前日の 0:00 から） */
  start: number;
  end: number;
  people: number;
  resource?: string;
  note?: string;
  ccp?: boolean;
  prevDay: boolean;
}

export interface ScheduleRow {
  line: Line;
  doughId: string;
  doughName: string;
  pieces: number;
  steps: ScheduleStep[];
}

export interface ScheduleOptions {
  /** ラインの当日の開始（0:00 からの分）。初期値は production.ts の lineSettings */
  startMinute?: Partial<Record<Line, number>>;
  /** 前日の仕込みの開始（初期値 13:00） */
  prevDayStartMinute?: number;
}

/**
 * 工程表: 生地ごとに工程を順に並べる。
 * ミキサー・オーブンなど「同時に1つしか使えない設備」は順番待ちにする。発酵・冷却は待ち時間なしで並行できる。
 */
export function buildSchedule(plan: ProductionPlan, opts: ScheduleOptions = {}): ScheduleRow[] {
  const prevStart = opts.prevDayStartMinute ?? 13 * 60;
  const free = new Map<string, number>(); // 設備 → 空く時刻（当日・前日で別キー）
  return plan.doughs.map((b) => {
    const d = findDough(b.doughId)!;
    const lineStart = opts.startMinute?.[b.line] ?? lineSettings[b.line].startMinute;
    let tToday = lineStart;
    let tPrev = prevStart;
    const steps = d.steps.map((s): ScheduleStep => {
      const dur =
        (s.minutes ?? 0) + (s.minutesPerBatch ?? 0) * b.batches + (s.piecesPerHour ? Math.ceil((b.pieces / s.piecesPerHour) * 60) : 0);
      const prevDay = !!s.prevDay;
      const resKey = s.resource ? `${prevDay ? "prev" : "today"}:${s.resource}` : undefined;
      const t = prevDay ? tPrev : tToday;
      const start = Math.max(t, resKey ? (free.get(resKey) ?? 0) : 0);
      const end = start + dur;
      if (resKey) free.set(resKey, end);
      if (prevDay) tPrev = end;
      else tToday = end;
      return { key: s.key, name: s.name, start, end, people: s.people ?? 0, resource: s.resource, note: s.note, ccp: s.ccp, prevDay };
    });
    return { line: b.line, doughId: b.doughId, doughName: b.name, pieces: b.pieces, steps };
  });
}

/** ラインごとの終わる時刻と、のべ作業時間（分×人） */
export function scheduleSummary(rows: ScheduleRow[]): { line: Line; start: number; end: number; laborMinutes: number }[] {
  return (Object.keys(lineSettings) as Line[])
    .map((line) => {
      const today = rows.filter((r) => r.line === line).flatMap((r) => r.steps.filter((s) => !s.prevDay));
      const all = rows.filter((r) => r.line === line).flatMap((r) => r.steps);
      return {
        line,
        start: today.length ? Math.min(...today.map((s) => s.start)) : 0,
        end: today.length ? Math.max(...today.map((s) => s.end)) : 0,
        laborMinutes: all.reduce((s, x) => s + (x.end - x.start) * x.people, 0),
      };
    })
    .filter((x) => x.end > 0);
}

/** 分 → "5:30"（24時を超えたら "翌1:00"） */
export function fmtTime(min: number): string {
  const m = Math.round(min);
  const day = Math.floor(m / 1440);
  const r = m - day * 1440;
  return `${day > 0 ? "翌" : ""}${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`;
}

/** トッピングの材料（1枚あたり g）を名前付きで返す */
export function toppingDetail(toppingId: string) {
  const t = findTopping(toppingId);
  return t?.items.map((i) => ({ ...i, name: findMaterial(i.materialId)?.name ?? i.materialId })) ?? [];
}
