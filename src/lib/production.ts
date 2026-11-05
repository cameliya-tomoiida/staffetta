// 製造計画と工程表。
// 自社で作る商品の個数 → 生地kg（ロス率込み）→ ミキサー回数・材料kg、ライン（パン・ピザ）ごとの上限チェック、
// 工程の時間割（工程表）を出す。全部ふつうの計算で、同じ入力なら必ず同じ結果になる。
import type { Line, ProcessKey } from "@/data/production";
import type { DayTotals } from "./aggregate";
import { allLines, allShifts, currentMasters, customerDeadline, customerDeliveryMinute, findDough, findEquipment, findLine, findMaterial, findProduct, findTopping } from "./catalog";

export interface DoughItem {
  productId: string;
  name: string;
  pieces: number;
  /** 1個の生地 g（分割g） */
  doughGram: number;
  toppingId?: string;
  /** この商品を注文した得意先（納品時刻から工程を逆算するのに使う） */
  customers?: string[];
  /** 得意先ごとの個数（便で分けるのに使う） */
  customerPieces?: { customerId: string; pieces: number }[];
}

export interface DoughIngredient {
  materialId: string;
  name: string;
  percent: number;
  kg: number;
}

export interface DoughBatchPlan {
  /** 生地を便で分けたときの区別（分けないときは doughId と同じ。分けたら "DG01#2"） */
  key: string;
  doughId: string;
  /** 便で分けたときの名前（例: 「午後便（売店）」） */
  waveName?: string;
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
  /** 上限に数える数（「ラインの上限に数えない」商品があるときだけ。無ければ pieces と同じ） */
  capPieces?: number;
  /** 冷凍庫（設備の種類「冷凍庫」の「入るケース数」）が登録されているとき: この日に作るケース数と上限 */
  freezerCases?: { need: number; cap: number };
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
  /**
   * 便（出発時刻）で生地を分ける間隔（分）。同じ生地の得意先で、作り終える時刻がこれ以上離れていたら別の仕込みにする。
   * 初期値 120。0 にすると分けない。
   */
  waveGapMinutes?: number;
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
      { productId: t.productId, name: t.name, pieces: t.pieces, doughGram: spec.doughGram, toppingId: spec.toppingId, customers: t.customers.map((c) => c.customerId), customerPieces: t.customers.map((c) => ({ customerId: c.customerId, pieces: c.pieces })) },
    ]);
    if (spec.toppingId) toppings.push({ productId: t.productId, toppingId: spec.toppingId, pieces: t.pieces });
  }

  const doughs: DoughBatchPlan[] = [...byDough.entries()].flatMap(([doughId, items]) =>
    splitByWave(doughId, items, opts.waveGapMinutes ?? 120).map((w, i, all) => ({
      ...doughBatch(doughId, w.items, opts.lossRates?.[doughId]),
      key: all.length > 1 ? `${doughId}#${i + 1}` : doughId,
      ...(all.length > 1 ? { waveName: w.name } : {}),
    })),
  );

  const lines: LinePlan[] = allLines().map((l) => l.line).map((line) => {
    const ls = findLine(line);
    const lineDoughs = doughs.filter((d) => d.line === line);
    const pieces = lineDoughs.reduce((s, d) => s + d.pieces, 0);
    // 上限に数える数（「ラインの上限に数えない」商品＝生地玉など は除く）
    const excluded = lineDoughs.flatMap((d) => d.items)
      .filter((it) => currentMasters().products.find((p) => p.id === it.productId)?.excludeFromDailyCap)
      .reduce((s, it) => s + it.pieces, 0);
    const capPieces = pieces - excluded;
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
    const overBy = cap !== undefined ? Math.max(0, capPieces - cap) : 0;
    const lw: string[] = [];
    if (overBy > 0) lw.push(`${ls.name} ${fmtNum(capPieces)}${ls.unit}${capPieces !== pieces ? `（上限に数えない ${fmtNum(pieces - capPieces)}${ls.unit} を除く）` : ""}: ${capReason} ${fmtNum(cap!)}${ls.unit}を ${fmtNum(overBy)}${ls.unit} 超えています`);
    const fz = freezerFor(line, lineDoughs);
    if (fz && fz.need > fz.cap) lw.push(`${ls.name}: この日に作る ${fmtNum(fz.need)}ケース が、冷凍庫（${fz.names}）の ${fmtNum(fz.cap)}ケース に入りきりません`);
    return { line, name: ls.name, unit: ls.unit, pieces, ...(capPieces !== pieces ? { capPieces } : {}), cap, capReason, overBy, ...(fz ? { freezerCases: { need: fz.need, cap: fz.cap } } : {}), doughs: lineDoughs, warnings: lw };
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

/**
 * 生地の得意先を「作り終える時刻」（便の出発 − 積み込み）で分ける。時刻が gap 分以上離れたら別の仕込み。
 * 開始時刻から組むライン（冷凍のピザ）や、得意先が分からないときは分けない。
 */
function splitByWave(doughId: string, items: DoughItem[], gap: number): { name?: string; items: DoughItem[] }[] {
  const d = findDough(doughId);
  if (!d || gap <= 0 || findLine(d.line).scheduleFrom !== "delivery") return [{ items }];
  // 得意先ごとの個数と作り終える時刻
  type Part = { customerId: string; minute: number; courseName: string };
  const parts = new Map<string, Part>();
  for (const it of items)
    for (const c of it.customers ?? []) {
      if (parts.has(c)) continue;
      const dl = customerDeadline(c, d.line);
      parts.set(c, { customerId: c, minute: dl.minute, courseName: dl.courseId ?? dl.basis });
    }
  if (parts.size < 2) return [{ items }];
  const sorted = [...parts.values()].sort((a, b) => a.minute - b.minute);
  const groups: Part[][] = [];
  for (const p of sorted) {
    const g = groups[groups.length - 1];
    if (g && p.minute - g[0].minute < gap) g.push(p);
    else groups.push([p]);
  }
  if (groups.length < 2) return [{ items }];
  return groups.map((g) => {
    const ids = new Set(g.map((p) => p.customerId));
    return {
      name: [...new Set(g.map((p) => p.courseName))].join("・"),
      items: items
        .map((it) => {
          const share = (it.customerPieces ?? []).filter((x) => ids.has(x.customerId));
          return { ...it, pieces: share.reduce((s, x) => s + x.pieces, 0), customers: share.map((x) => x.customerId), customerPieces: share };
        })
        .filter((it) => it.pieces > 0),
    };
  });
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
    key: doughId,
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
  /** ロットで流す工程が、設備の使えない時間帯（霜取りなど）で止まった分（分）。止まる分だけ終わりが延びている */
  pausedMinutes?: number;
}

export interface ScheduleRow {
  /** 生地を便で分けたときの区別（DoughBatchPlan.key） */
  key: string;
  /** 便で分けたときの名前 */
  waveName?: string;
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
  /** 逆算のとき: 最後の工程が終わっていなければならない時刻（便の出発 − 積み込み、または 納品時刻 − 積み込み・配送） */
  deadline?: number;
  /** 作り終える時刻の根拠（「東コース（早朝便） 05:30 出発」「納品 7:30」） */
  deadlineBasis?: string;
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

/**
 * 冷凍庫の容量: そのライン（または共用）の設備の種類「冷凍庫」の「入るケース数」の合計と、この日に作るケース数。
 * ケース数は商品の「ケースの入数」で割って切り上げ（入数が無い商品は数えない）。冷凍庫が登録されていなければ undefined。
 */
function freezerFor(line: Line, doughs: DoughBatchPlan[]): { need: number; cap: number; names: string } | undefined {
  const m = currentMasters();
  const fz = m.equipment.filter((e) => e.kind === "freezer" && e.active !== false && (e.line === line || e.line === "common") && (e.capacityCases ?? 0) > 0);
  if (!fz.length) return undefined;
  const cap = fz.reduce((a, e) => a + (e.capacityCases ?? 0) * (e.count || 1), 0);
  const need = doughs.flatMap((d) => d.items).reduce((a, it) => {
    const cs = m.products.find((p) => p.id === it.productId)?.caseSize;
    return a + (cs && cs > 0 ? Math.ceil(it.pieces / cs) : 0);
  }, 0);
  return { need, cap, names: fz.map((e) => e.name).join("・") };
}

/** 手で分割するときの速さ（1人・1時間あたりの個数）と人数 */
export const HAND_DIVIDE_PER_PERSON_HOUR = 300;
export const HAND_DIVIDE_PEOPLE = 2;

type StepLike = { key: ProcessKey; minutes?: number; minutesPerBatch?: number; piecesPerHour?: number; people?: number; equipmentId?: string };

/**
 * 工程の実際の時間（分）と人数。
 * 分割機の重さの範囲（下限〜上限 g）の外の商品は「手分割」として、手の速さで時間を足し、人数を足す。
 */
function effective(s: StepLike, b: DoughBatchPlan): { dur: number; people: number; handPieces: number; handNote?: string } {
  let machinePieces = b.pieces;
  let extra = 0;
  let people = s.people ?? 0;
  let handPieces = 0;
  let handNote: string | undefined;
  if (s.key === "divide" && s.equipmentId) {
    const eq = findEquipment(s.equipmentId);
    const out = (g: number) => (eq?.minPieceGram !== undefined && g < eq.minPieceGram) || (eq?.maxPieceGram !== undefined && g > eq.maxPieceGram);
    const hand = b.items.filter((i) => out(i.doughGram));
    handPieces = hand.reduce((x, i) => x + i.pieces, 0);
    if (eq && handPieces > 0) {
      machinePieces -= handPieces;
      extra = Math.ceil((handPieces / (HAND_DIVIDE_PER_PERSON_HOUR * HAND_DIVIDE_PEOPLE)) * 60);
      people += HAND_DIVIDE_PEOPLE;
      handNote = `手分割 ${handPieces}個（${[...new Set(hand.map((i) => `${i.doughGram}g`))].join("・")}。${eq.name}は ${eq.minPieceGram ?? "-"}〜${eq.maxPieceGram ?? "-"}g）`;
    }
  }
  const machine = s.piecesPerHour && machinePieces > 0 ? Math.ceil((machinePieces / s.piecesPerHour) * 60) : 0;
  return { dur: (s.minutes ?? 0) + (s.minutesPerBatch ?? 0) * b.batches + machine + extra, people, handPieces, handNote };
}

const stepMinutes = (s: StepLike, b: DoughBatchPlan) => effective(s, b).dur;

/** 設備の「使えない時間帯」（"17:00-17:40"）を、0:00 からの分の組にする */
function downtimesOf(equipmentId?: string): [number, number][] {
  const eq = equipmentId ? findEquipment(equipmentId) : undefined;
  return (eq?.downtimes ?? [])
    .map((w) => w.split("-").map((x) => x.trim()))
    .filter((p) => p.length === 2)
    .map(([a, b]) => [hhmm(a), hhmm(b)] as [number, number])
    .filter(([a, b]) => b > a);
}

/** start から dur 分、使えない時間帯（毎日くり返す）に重ならない、いちばん早い開始 */
function laterFree(start: number, dur: number, downs: [number, number][]): number {
  let t = start;
  for (let k = 0; k < 10 && downs.length; k++) {
    const base = t - tod(t);
    const hit = downs
      .flatMap(([a, b]) => [-1440, 0, 1440].map((d) => [base + d + a, base + d + b] as [number, number]))
      .find(([a, b]) => t < b && t + dur > a);
    if (!hit) break;
    t = hit[1];
  }
  return t;
}

/** [start, end) の中で、使えない時間帯（毎日くり返す）に重なる分の合計 */
function overlapMinutes(start: number, end: number, downs: [number, number][]): number {
  let sum = 0;
  for (let day = Math.floor(start / 1440) - 1; day <= Math.floor(end / 1440) + 1; day++)
    for (const [a, b] of downs) sum += Math.max(0, Math.min(end, day * 1440 + b) - Math.max(start, day * 1440 + a));
  return sum;
}

/** end で終わる dur 分が、使えない時間帯に重なるとき、どれだけ前にずらせばよいか（分） */
function earlierShift(end: number, dur: number, downs: [number, number][]): number {
  const start = end - dur;
  const base = start - tod(start);
  const hit = downs
    .flatMap(([a, b]) => [-1440, 0, 1440].map((d) => [base + d + a, base + d + b] as [number, number]))
    .find(([a, b]) => start < b && end > a);
  return hit ? end - hit[0] : 0;
}

const toStep = (s: StepLike & { name: string; resource?: string; note?: string; ccp?: boolean }, start: number, end: number, prevDay: boolean, b?: DoughBatchPlan): ScheduleStep => {
  const e = b ? effective(s, b) : undefined;
  const note = [s.note, e?.handNote].filter(Boolean).join("。") || undefined;
  return {
    key: s.key, name: s.name, start, end, people: e?.people ?? s.people ?? 0, resource: s.resource,
    ...(s.equipmentId ? { equipmentId: s.equipmentId } : {}), note, ccp: s.ccp, prevDay,
  };
};

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
  // 段取り替え: 同じ設備・作業場で、前とちがう生地に替えるときは、ラインの「段取り替え（分）」だけあける
  const lastDough = new Map<string, string>(); // 設備 → 最後に使った生地
  const freeFor = (key: string | undefined, b: DoughBatchPlan) => {
    if (!key) return 0;
    const f = freeAfter.get(key);
    if (f === undefined) return 0;
    return f + (lastDough.get(key) !== b.doughId ? findLine(b.line).changeoverMinutes : 0);
  };
  const use = (key: string | undefined, b: DoughBatchPlan, end: number) => {
    if (!key) return;
    freeAfter.set(key, end);
    lastDough.set(key, b.doughId);
  };
  const fromOf = (line: Line) => (opts.mode === "forward" ? "start" : findLine(line).scheduleFrom);

  // 前日の作業（ピザの仕込みなど）は、どのラインも前日 13:00 から前へ順に積む
  const prevSteps = new Map<string, ScheduleStep[]>();
  for (const b of plan.doughs) {
    let t = opts.prevDayStartMinute ?? findLine(b.line).prevDayStartMinute;
    prevSteps.set(b.key, findDough(b.doughId)!.steps.filter((s) => s.prevDay).map((s) => {
      const key = s.resource ? `prev:${s.resource}` : undefined;
      const dur = stepMinutes(s, b);
      const start = laterFree(Math.max(t, freeFor(key, b)), dur, downtimesOf(s.equipmentId));
      const end = start + dur;
      use(key, b, end);
      t = end;
      return toStep(s, start, end, true, b);
    }));
  }

  // 前から積むライン
  for (const b of plan.doughs.filter((b) => fromOf(b.line) === "start")) {
    let t = opts.startMinute?.[b.line] ?? findLine(b.line).startMinute;
    // 前日の作業（冷凍庫で12時間 など）が当日の朝まで続くときは、それが終わってから当日の作業を始める
    const prevDone = Math.max(-Infinity, ...prevSteps.get(b.key)!.map((x) => x.end)) - 1440;
    if (prevDone > t) t = prevDone;
    // ロットで流す: 次の工程は、前の工程の最初のロットが終わったら始められる（終わりは、前の工程の最後のロット＋1ロット分より後）
    const lots = lotsOf(b);
    let firstReady = t;
    let prevEnd = t;
    const today = findDough(b.doughId)!.steps.filter((s) => !s.prevDay).map((s, i) => {
      const key = s.resource ? `today:${s.resource}` : undefined;
      const dur = stepMinutes(s, b);
      if (lots === 1) {
        // 設備の使えない時間帯（霜取りなど）にかかるなら、終わるまで待つ
        const start = laterFree(Math.max(t, freeFor(key, b)), dur, downtimesOf(s.equipmentId));
        const end = start + dur;
        use(key, b, end);
        t = end;
        return toStep(s, start, end, false, b);
      }
      // 待つだけの工程（発酵・冷却）はロットごとに同時に進む。人・設備の工程は1ロットずつ
      const per = isWaitStep(s) ? dur : dur / lots;
      const start = laterFree(Math.max(i === 0 ? t : firstReady, freeFor(key, b)), Math.ceil(per), downtimesOf(s.equipmentId));
      let end = Math.ceil(Math.max(start + dur, prevEnd + per));
      // 流している途中で設備が使えない時間帯（霜取りなど）は止まる。その分だけ終わりを延ばす（前の工程の品物はラックで待つ）
      const downs = downtimesOf(s.equipmentId);
      let paused = 0;
      for (let k = 0; k < 5 && downs.length; k++) {
        const over = overlapMinutes(start, end, downs) - paused;
        if (over <= 0) break;
        paused += over;
        end += over;
      }
      use(key, b, end);
      firstReady = Math.ceil(start + per);
      prevEnd = end;
      t = end;
      const st = toStep(s, start, end, false, b);
      return paused ? { ...st, pausedMinutes: paused, note: [st.note, `${findEquipment(s.equipmentId!)?.name ?? ""}が使えない時間帯で ${paused}分 止まる`].filter(Boolean).join("。") } : st;
    });
    rows.set(b.key, { key: b.key, ...(b.waveName ? { waveName: b.waveName } : {}), line: b.line, doughId: b.doughId, doughName: b.name, pieces: b.pieces, steps: [...prevSteps.get(b.key)!, ...today], from: "start", warnings: [] });
  }

  // 納品時刻から逆算するライン: 締めの遅い生地から順に、後ろから並べる（ロットで流すラインは、流したときの並びのまま後ろに合わせる）
  const busyDough = new Map<string, string>(); // 後ろから積む: 設備 → いちばん前で使っている生地
  const backward = plan.doughs
    .filter((b) => fromOf(b.line) === "delivery")
    .map((b) => {
      const custs = [...new Set(b.items.flatMap((i) => i.customers ?? []))];
      // 得意先ごとに「作り終える時刻」（便があれば出発 − 積み込み、無ければ納品 − 積み込み・配送）。いちばん早い得意先に合わせる
      const times = custs.map((c) => ({ c, dl: customerDeadline(c, b.line, opts.deliveryMinute?.[c]), m: opts.deliveryMinute?.[c] ?? customerDeliveryMinute(c) }));
      const first = times.sort((a, b) => a.dl.minute - b.dl.minute)[0];
      if (!first) return { b, deliveryMinute: customerDeliveryMinute(""), customerId: undefined, deadline: customerDeliveryMinute("") - findLine(b.line).shipBufferMinutes, basis: "" };
      return { b, deliveryMinute: first.m, customerId: first.c, deadline: first.dl.minute, basis: first.dl.basis };
    })
    .sort((x, y) => y.deadline - x.deadline || x.b.key.localeCompare(y.b.key));
  for (const { b, deliveryMinute, customerId, deadline, basis } of backward) {
    // 工程はすき間なく続けて並べる（発酵が延びないように）。設備がふさがっていれば、生地全体を前にずらす
    const src = findDough(b.doughId)!.steps.filter((s) => !s.prevDay);
    const durs = src.map((s) => stepMinutes(s, b));
    const rel = flowLayout(src, durs, lotsOf(b));
    const total = rel.length ? rel[rel.length - 1][1] : 0;
    const place = (end: number) => src.map((s, i) => toStep(s, end - total + rel[i][0], end - total + rel[i][1], false, b));
    let shift = 0;
    let today = place(deadline);
    for (let k = 0; k < 10; k++) {
      const need = Math.max(
        0,
        ...today.filter((x) => x.resource).map((x) => {
          const k = `today:${x.resource}`;
          const co = busyDough.has(k) && busyDough.get(k) !== b.doughId ? findLine(b.line).changeoverMinutes : 0;
          return x.end - ((busyFrom.get(k) ?? Infinity) - co);
        }),
        ...today.map((x) => earlierShift(x.end, x.end - x.start, downtimesOf(x.equipmentId))),
      );
      if (need <= 0) break;
      shift += need;
      today = place(deadline - shift);
    }
    for (const x of today) {
      if (!x.resource) continue;
      const k = `today:${x.resource}`;
      if (x.start < (busyFrom.get(k) ?? Infinity)) {
        busyFrom.set(k, x.start);
        busyDough.set(k, b.doughId);
      }
    }
    const warnings = today.length && today[0].start < findLine(b.line).earliestStartMinute ? [`${b.name}${b.waveName ? `（${b.waveName}）` : ""}: ${basis || `納品 ${fmtTime(deliveryMinute)}`} に間に合わせるには ${fmtTime(today[0].start)} に始める必要があります（${fmtTime(findLine(b.line).earliestStartMinute)} より前）`] : [];
    rows.set(b.key, {
      key: b.key, ...(b.waveName ? { waveName: b.waveName } : {}), line: b.line, doughId: b.doughId, doughName: b.name, pieces: b.pieces, steps: [...prevSteps.get(b.key)!, ...today],
      from: "delivery", deliveryMinute, deliveryCustomerId: customerId, deadline, ...(basis ? { deadlineBasis: basis } : {}), warnings,
    });
  }

  const out = plan.doughs.map((b) => rows.get(b.key)!);
  for (const b of plan.doughs) {
    const row = rows.get(b.key)!;
    for (const st of findDough(b.doughId)!.steps) {
      const e = effective(st, b);
      if (e.handNote) row.warnings.push(`${b.name}: 分割機の重さの範囲の外なので ${e.handNote.replace(/^手分割 /, "")} を手で分割します（${HAND_DIVIDE_PEOPLE}人）`);
    }
  }
  // 1日の終わりの洗浄・片付け: ラインのその日の最後の工程のあとに入れる
  for (const line of [...new Set(out.map((r) => r.line))]) {
    const mins = findLine(line).cleanupMinutes;
    if (!mins) continue;
    let last: { row: ScheduleRow; step: ScheduleStep } | undefined;
    for (const row of out.filter((r) => r.line === line))
      for (const step of row.steps.filter((x) => !x.prevDay)) if (!last || step.end > last.step.end) last = { row, step };
    if (!last) continue;
    last.row.steps.push({ key: "cleanup", name: "洗浄・片付け（1日の終わり）", start: last.step.end, end: last.step.end + mins, people: Math.max(1, last.step.people), prevDay: false, note: `ラインの設定「1日の終わりの洗浄・片付け」${mins}分` });
  }
  checkScheduleConstraints(out, plan.date);
  return out;
}

/** 待つだけの工程（発酵・冷却など。人も設備の能力も使わない） */
const isWaitStep = (s: StepLike) => !s.piecesPerHour && !s.minutesPerBatch && !(s.people && s.people > 0);

/** ラインの「流すロット」で、この生地を何ロットに分けるか（流さないなら 1） */
function lotsOf(b: DoughBatchPlan): number {
  const lotSize = findLine(b.line).lotSize;
  return lotSize && b.pieces > lotSize ? Math.ceil(b.pieces / lotSize) : 1;
}

/**
 * ロットで流したときの、工程ごとの [始め, 終わり]（最初の工程の始めを 0 とした分）。
 * 次の工程は、前の工程の最初のロットが終わったら始まり、終わりは「前の工程の最後のロット＋1ロット分」より後。
 * lots = 1 なら、すき間なく1つずつ並べるのと同じ。
 */
function flowLayout(src: StepLike[], durs: number[], lots: number): [number, number][] {
  let firstReady = 0;
  let prevEnd = 0;
  return src.map((s, i) => {
    const per = lots === 1 || isWaitStep(s) ? durs[i] : durs[i] / lots;
    const start = i === 0 ? 0 : firstReady;
    const end = Math.ceil(Math.max(start + durs[i], prevEnd + per));
    firstReady = Math.ceil(start + per);
    prevEnd = end;
    return [start, end];
  });
}

const tod = (min: number) => ((Math.round(min) % 1440) + 1440) % 1440;
/** 時刻（0:00 からの分。前日・翌日でもよい）が "HH:MM"〜"HH:MM" の中か（日をまたぐ時間帯もよい） */
function inWindow(min: number, from: string, to: string): boolean {
  const m = tod(min);
  const f = hhmm(from);
  const t = hhmm(to);
  return f <= t ? m >= f && m <= t : m >= f || m <= t;
}
/** inWindow と同じだが、終わりの時刻は含めない（人数の区切りに使う） */
function inSpan(min: number, from: string, to: string): boolean {
  const m = tod(min);
  const f = hhmm(from);
  const t = hhmm(to);
  return f <= t ? m >= f && m < t : m >= f || m < t;
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
export function checkScheduleConstraints(rows: ScheduleRow[], date?: string): void {
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

  // 設備の使えない時間帯（霜取りなど）に重なっていないか
  for (const { row, step } of uses) {
    if (!step.equipmentId || step.end <= step.start || step.pausedMinutes) continue;
    if (earlierShift(step.end, step.end - step.start, downtimesOf(step.equipmentId)) > 0) {
      const eq = findEquipment(step.equipmentId)!;
      row.warnings.push(`${row.doughName}: ${step.name}（${fmtTime(step.start)}〜${fmtTime(step.end)}）が ${eq.name} の使えない時間（${(eq.downtimes ?? []).join("・")}）にかかっています`);
    }
  }

  // 人数（当日の作業。班が登録されているラインだけ）。足りない時間帯は、続いている区間ごとに1行にまとめる
  const shifts = allShifts();
  for (const line of [...new Set(rows.map((r) => r.line))]) {
    // 曜日のある班は、その曜日（製造日）だけ数える
    const wd = date ? new Date(`${date}T00:00:00Z`).getUTCDay() : undefined;
    const lineShifts = shifts.filter((s) => (s.line === line || s.line === "common") && (wd === undefined || !s.weekdays?.length || s.weekdays.includes(wd)));
    // 班が1つも登録されていないラインは見ない（その曜日に出る班が無いだけなら「0人」として見る）
    if (!shifts.some((s) => s.line === line || s.line === "common")) continue;
    const act = uses.filter((u) => u.row.line === line && !u.step.prevDay && u.step.people > 0 && u.step.end > u.step.start);
    // 区切り: 工程の始め・終わりと、班の出入り・休けいの始め・終わり（人数が変わる時刻）
    const lo = Math.min(...act.map((u) => u.step.start));
    const hi = Math.max(...act.map((u) => u.step.end));
    const shiftPoints = lineShifts.flatMap((x) => [x.from, x.to, ...(x.breaks ?? []).flatMap((w) => w.split("-").map((y) => y.trim()))])
      .filter((t) => /^\d{1,2}:\d{2}$/.test(t)).map(hhmm)
      .flatMap((m) => [m - 1440, m, m + 1440]).filter((m) => m > lo && m < hi);
    const points = [...new Set([...act.flatMap((u) => [u.step.start, u.step.end]), ...shiftPoints])].sort((a, b) => a - b);
    type Seg = { from: number; to: number; need: number; have: number; uses: Use[] };
    const short: Seg[] = [];
    for (let i = 0; i + 1 < points.length; i++) {
      const from = points[i], to = points[i + 1];
      const on = act.filter((u) => u.step.start <= from && from < u.step.end);
      const need = on.reduce((s, u) => s + u.step.people, 0);
      // 班の時間・休けいは「始め以上・終わり未満」で数える（18:00 に帰る班は 18:00 からの区切りに入れない）
      const have = lineShifts
        .filter((s) => inSpan(from, s.from, s.to) && !(s.breaks ?? []).some((w) => { const [a, b] = w.split("-").map((x) => x.trim()); return !!a && !!b && inSpan(from, a, b); }))
        .reduce((s, x) => s + x.headcount, 0);
      if (need <= have) continue;
      const last = short[short.length - 1];
      if (last && last.to === from) {
        last.to = to;
        if (need - have > last.need - last.have) Object.assign(last, { need, have });
        for (const u of on) if (!last.uses.includes(u)) last.uses.push(u);
      } else short.push({ from, to, need, have, uses: [...on] });
    }
    const lineName = findLine(line as Line).name;
    for (const g of short) {
      const by = new Map<string, number>();
      for (const u of g.uses) by.set(u.step.name, Math.max(by.get(u.step.name) ?? 0, u.step.people));
      const detail = [...by.entries()].map(([n, p]) => `${n} ${p}`).join("・");
      g.uses[0].row.warnings.push(`${lineName} ${fmtTime(g.from)}〜${fmtTime(g.to)} は人が ${g.need - g.have}人 たりません（要る ${g.need}人・班 ${g.have}人：${detail}）`);
    }
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
