// 製造計画と工程表。
// 自社で作る商品の個数 → 生地kg（ロス率込み）→ ミキサー回数・材料kg、ライン（パン・ピザ）ごとの上限チェック、
// 工程の時間割（工程表）を出す。全部ふつうの計算で、同じ入力なら必ず同じ結果になる。
import type { Line, ProcessKey } from "@/data/production";
import type { DayTotals } from "./aggregate";
import { allLines, allShifts, customerDeliveryMinute, findDough, findEquipment, findLine, findMaterial, findProduct, findTopping } from "./catalog";

export interface DoughItem {
  productId: string;
  name: string;
  pieces: number;
  /** 1個の生地 g（分割g） */
  doughGram: number;
  toppingId?: string;
  /** この商品を注文した得意先（納品時刻から工程を逆算するのに使う） */
  customers?: string[];
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
  /** 数の単位（個・枚） */
  unit: string;
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
  /** 生地のロス率を上書き（棚卸の補正案を人が承認したもの）。doughId → 0.05 など */
  lossRates?: Record<string, number>;
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
      { productId: t.productId, name: t.name, pieces: t.pieces, doughGram: spec.doughGram, toppingId: spec.toppingId, customers: t.customers.map((c) => c.customerId) },
    ]);
    if (spec.toppingId) toppings.push({ productId: t.productId, toppingId: spec.toppingId, pieces: t.pieces });
  }

  const doughs: DoughBatchPlan[] = [...byDough.entries()].map(([doughId, items]) => doughBatch(doughId, items, opts.lossRates?.[doughId]));

  const lines: LinePlan[] = allLines().map((l) => l.line).map((line) => {
    const ls = findLine(line);
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
    if (overBy > 0) lw.push(`${ls.name} ${fmtNum(pieces)}${ls.unit}: ${capReason} ${fmtNum(cap!)}${ls.unit}を ${fmtNum(overBy)}${ls.unit} 超えています`);
    return { line, name: ls.name, unit: ls.unit, pieces, cap, capReason, overBy, doughs: lineDoughs, warnings: lw };
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
export function doughBatch(doughId: string, items: DoughItem[], lossRateOverride?: number): DoughBatchPlan {
  const d = findDough(doughId);
  if (!d) throw new Error(`生地 ${doughId} がありません`);
  const pieces = items.reduce((s, i) => s + i.pieces, 0);
  const netKg = items.reduce((s, i) => s + (i.pieces * i.doughGram) / 1000, 0);
  const lossRate = lossRateOverride ?? d.lossRate;
  const doughKg = netKg / (1 - lossRate);
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
    lossRate,
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
  /** 使う設備の ID（マスタの設備） */
  equipmentId?: string;
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
  /** 組み方: "delivery" = 納品時刻から逆算 / "start" = 開始時刻から順に */
  from: "delivery" | "start";
  /** 逆算のとき: いちばん早い納品時刻（0:00 からの分）と、その得意先 */
  deliveryMinute?: number;
  deliveryCustomerId?: string;
  /** 逆算のとき: 最後の工程が終わっていなければならない時刻（納品時刻 − 積み込み・配送） */
  deadline?: number;
  warnings: string[];
}

export interface ScheduleOptions {
  /** ラインの当日の開始（0:00 からの分）。"start" で組むラインに使う。初期値は lineSettings */
  startMinute?: Partial<Record<Line, number>>;
  /** 前日の仕込みの開始（初期値 13:00） */
  prevDayStartMinute?: number;
  /** "auto"（初期値）: ラインの設定どおり / "forward": 全部 開始時刻から順に組む */
  mode?: "auto" | "forward";
  /** 得意先の納品時刻（分）を上書き。無ければ得意先マスタ、それも無ければ 8:00 */
  deliveryMinute?: Record<string, number>;
}

const stepMinutes = (s: { minutes?: number; minutesPerBatch?: number; piecesPerHour?: number }, b: DoughBatchPlan) =>
  (s.minutes ?? 0) + (s.minutesPerBatch ?? 0) * b.batches + (s.piecesPerHour ? Math.ceil((b.pieces / s.piecesPerHour) * 60) : 0);

const toStep = (s: { key: ProcessKey; name: string; people?: number; resource?: string; equipmentId?: string; note?: string; ccp?: boolean }, start: number, end: number, prevDay: boolean): ScheduleStep => ({
  key: s.key, name: s.name, start, end, people: s.people ?? 0, resource: s.resource, ...(s.equipmentId ? { equipmentId: s.equipmentId } : {}), note: s.note, ccp: s.ccp, prevDay,
});

/**
 * 工程表: 生地ごとに工程の開始・終了の時刻を出す。
 * - パン（その日に作って届ける）: 納品時刻から逆算する。いちばん早い得意先の納品時刻 − 積み込み・配送 に、
 *   最後の工程（金属検出）が終わるように、後ろから並べる。納品時刻は得意先マスタ、無ければ 8:00。
 * - ピザ（冷凍で在庫にする）: その日の開始時刻から順に並べる。前日の仕込みは前日 13:00 から。
 * ミキサー・オーブンなど「同時に1つしか使えない設備」は重ならないようにずらす。発酵・冷却は並行できる。
 * 開始が 0:00 より前になったら（前日にかかる）warnings に出す。
 */
export function buildSchedule(plan: ProductionPlan, opts: ScheduleOptions = {}): ScheduleRow[] {
  const rows = new Map<string, ScheduleRow>();
  const freeAfter = new Map<string, number>(); // 前から積む: 設備 → 空く時刻
  const busyFrom = new Map<string, number>(); // 後ろから積む: 設備 → これより前なら空いている
  const fromOf = (line: Line) => (opts.mode === "forward" ? "start" : findLine(line).scheduleFrom);

  // 前日の作業（ピザの仕込みなど）は、どのラインも前日 13:00 から前へ順に積む
  const prevSteps = new Map<string, ScheduleStep[]>();
  for (const b of plan.doughs) {
    let t = opts.prevDayStartMinute ?? findLine(b.line).prevDayStartMinute;
    prevSteps.set(b.doughId, findDough(b.doughId)!.steps.filter((s) => s.prevDay).map((s) => {
      const key = s.resource ? `prev:${s.resource}` : undefined;
      const start = Math.max(t, key ? (freeAfter.get(key) ?? 0) : 0);
      const end = start + stepMinutes(s, b);
      if (key) freeAfter.set(key, end);
      t = end;
      return toStep(s, start, end, true);
    }));
  }

  // 前から積むライン
  for (const b of plan.doughs.filter((b) => fromOf(b.line) === "start")) {
    let t = opts.startMinute?.[b.line] ?? findLine(b.line).startMinute;
    const today = findDough(b.doughId)!.steps.filter((s) => !s.prevDay).map((s) => {
      const key = s.resource ? `today:${s.resource}` : undefined;
      const start = Math.max(t, key ? (freeAfter.get(key) ?? 0) : 0);
      const end = start + stepMinutes(s, b);
      if (key) freeAfter.set(key, end);
      t = end;
      return toStep(s, start, end, false);
    });
    rows.set(b.doughId, { line: b.line, doughId: b.doughId, doughName: b.name, pieces: b.pieces, steps: [...prevSteps.get(b.doughId)!, ...today], from: "start", warnings: [] });
  }

  // 納品時刻から逆算するライン: 締めの遅い生地から順に、後ろから並べる
  const backward = plan.doughs
    .filter((b) => fromOf(b.line) === "delivery")
    .map((b) => {
      const custs = [...new Set(b.items.flatMap((i) => i.customers ?? []))];
      const times = custs.map((c) => ({ c, m: opts.deliveryMinute?.[c] ?? customerDeliveryMinute(c) }));
      const first = times.sort((a, b) => a.m - b.m)[0] ?? { c: undefined, m: customerDeliveryMinute("") };
      return { b, deliveryMinute: first.m, customerId: first.c, deadline: first.m - findLine(b.line).shipBufferMinutes };
    })
    .sort((x, y) => y.deadline - x.deadline || x.b.doughId.localeCompare(y.b.doughId));
  for (const { b, deliveryMinute, customerId, deadline } of backward) {
    // 工程はすき間なく続けて並べる（発酵が延びないように）。設備がふさがっていれば、生地全体を前にずらす
    const src = findDough(b.doughId)!.steps.filter((s) => !s.prevDay);
    const durs = src.map((s) => stepMinutes(s, b));
    const total = durs.reduce((x, y) => x + y, 0);
    const place = (end: number) => {
      let t = end - total;
      return src.map((s, i) => {
        const st = toStep(s, t, t + durs[i], false);
        t += durs[i];
        return st;
      });
    };
    let today = place(deadline);
    const shift = Math.max(0, ...today.filter((x) => x.resource).map((x) => x.end - (busyFrom.get(`today:${x.resource}`) ?? Infinity)));
    if (shift > 0) today = place(deadline - shift);
    for (const x of today) if (x.resource) busyFrom.set(`today:${x.resource}`, Math.min(busyFrom.get(`today:${x.resource}`) ?? Infinity, x.start));
    const warnings = today.length && today[0].start < findLine(b.line).earliestStartMinute ? [`${b.name}: 納品 ${fmtTime(deliveryMinute)} に間に合わせるには ${fmtTime(today[0].start)} に始める必要があります（${fmtTime(findLine(b.line).earliestStartMinute)} より前）`] : [];
    rows.set(b.doughId, {
      line: b.line, doughId: b.doughId, doughName: b.name, pieces: b.pieces, steps: [...prevSteps.get(b.doughId)!, ...today],
      from: "delivery", deliveryMinute, deliveryCustomerId: customerId, deadline, warnings,
    });
  }

  const out = plan.doughs.map((b) => rows.get(b.doughId)!);
  checkScheduleConstraints(out);
  return out;
}

const tod = (min: number) => ((Math.round(min) % 1440) + 1440) % 1440;
/** 時刻（0:00 からの分。前日・翌日でもよい）が "HH:MM"〜"HH:MM" の中か（日をまたぐ時間帯もよい） */
function inWindow(min: number, from: string, to: string): boolean {
  const m = tod(min);
  const f = hhmm(from);
  const t = hhmm(to);
  return f <= t ? m >= f && m <= t : m >= f || m <= t;
}
const hhmm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + (m || 0);
};

/**
 * 工程表の制約を確かめて、各生地の warnings に足す（並びは変えない）。
 * - 設備の使える時間帯の外で使っている
 * - 同じ設備（同時に動かせないグループ）が重なっている
 * - 同じ時間に要る人数が、その時間の班の人数を超えている（班が登録されているラインだけ）
 */
export function checkScheduleConstraints(rows: ScheduleRow[]): void {
  type Use = { row: ScheduleRow; step: ScheduleStep };
  const uses: Use[] = rows.flatMap((row) => row.steps.map((step) => ({ row, step })));

  // 設備の使える時間帯
  for (const { row, step } of uses) {
    if (!step.equipmentId || step.end <= step.start) continue;
    const eq = findEquipment(step.equipmentId);
    if (!eq) continue;
    if (!inWindow(step.start, eq.availableFrom, eq.availableTo) || !inWindow(step.end - 1, eq.availableFrom, eq.availableTo))
      row.warnings.push(`${row.doughName}: ${step.name}（${fmtTime(step.start)}〜${fmtTime(step.end)}）は ${eq.name} の使える時間（${eq.availableFrom}〜${eq.availableTo}）の外です`);
  }

  // 設備の重なり（前日と当日は別に見る）
  const byRes = new Map<string, Use[]>();
  for (const u of uses) if (u.step.resource && u.step.end > u.step.start) {
    const k = `${u.step.prevDay ? "prev" : "today"}:${u.step.resource}`;
    byRes.set(k, [...(byRes.get(k) ?? []), u]);
  }
  for (const list of byRes.values()) {
    list.sort((a, b) => a.step.start - b.step.start);
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      if (b.step.start < a.step.end && a.row !== b.row) {
        const eq = b.step.equipmentId ? findEquipment(b.step.equipmentId) : undefined;
        b.row.warnings.push(`${b.row.doughName}: ${b.step.name}（${fmtTime(b.step.start)}〜）が ${a.row.doughName} と ${eq?.exclusiveGroup ?? eq?.name ?? b.step.resource} で重なっています`);
      }
    }
  }

  // 人数（当日の作業。班が登録されているラインだけ）
  const shifts = allShifts();
  for (const { row, step } of uses) {
    if (step.prevDay || step.people <= 0 || step.end <= step.start) continue;
    const lineShifts = shifts.filter((s) => s.line === row.line || s.line === "common");
    if (!lineShifts.length) continue;
    const at = step.start;
    const need = uses
      .filter((u) => !u.step.prevDay && u.row.line === row.line && u.step.start <= at && at < u.step.end)
      .reduce((s, u) => s + u.step.people, 0);
    const have = lineShifts.filter((s) => inWindow(at, s.from, s.to)).reduce((s, x) => s + x.headcount, 0);
    if (need > have)
      row.warnings.push(`${row.doughName}: ${step.name}（${fmtTime(step.start)}〜）の時間に人が足りません（同じ時間に ${need}人 要る・班は ${have}人）`);
  }
}

/** 工程表の注意（前日にかかる など）をまとめて返す */
export const scheduleWarnings = (rows: ScheduleRow[]) => rows.flatMap((r) => r.warnings);

/** ラインごとの終わる時刻と、のべ作業時間（分×人） */
export function scheduleSummary(rows: ScheduleRow[]): { line: Line; start: number; end: number; laborMinutes: number }[] {
  return allLines().map((l) => l.line)
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

/** 分 → "5:30"（24時を超えたら "翌1:00"、0時より前なら "前日22:00"） */
export function fmtTime(min: number): string {
  const m = Math.round(min);
  if (m < 0) {
    const r = ((m % 1440) + 1440) % 1440;
    return `前日${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`;
  }
  const day = Math.floor(m / 1440);
  const r = m - day * 1440;
  return `${day > 0 ? "翌" : ""}${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`;
}

/** トッピングの材料（1枚あたり g）を名前付きで返す */
export function toppingDetail(toppingId: string) {
  const t = findTopping(toppingId);
  return t?.items.map((i) => ({ ...i, name: findMaterial(i.materialId)?.name ?? i.materialId })) ?? [];
}
