// 製品カード（⑦の(13)・第2版 (20)）。工場で毎日書いている紙（生地ごと・日ごとに1枚）をタブレットで入力する。純関数だけ。
// 「この1枚を残せば、その生地の製品が どの工程を・だれが・何時に 通ったか全部わかる」形:
//   上の帯（日付・天候・室温・湿度・生地・記入者）
//   工程の表（計量・ミキサー・分割・成型・焼成・急速冷凍・包装・金属検査 … 生地の工程のマスタの順。はじめ／おわり／担当者／温度の確認）
//   ミキサーの表（こねた回ごと: 水温・捏上時間・捏上温度・担当者）
//   製品の表（この生地からとった製品ごと: 重量・注文数・仕込数・製品数・焼成の温度と時間・包装の数・ロス・在庫・金属・官能）
//   メモ・責任者の確認
// 基準はマスタから（プログラムに固定の値は持たない）:
//   目標の捏上温度・許す幅 … 生地（マスタ管理 → レシピと工程）
//   焼成の温度・時間・許す幅 … 商品（マスタ管理 → 商品）
//   工程の温度（急速冷凍など） … 工程（マスタ管理 → くわしいマスタ → 工程）
// 分かっていること（CardBase）はアプリが入れる。現場で測ること（CardInput）だけ人が入れる。
import type { DoughMaster, ProcessStepKey, ProcessStepMaster, ProductMaster, ShiftMaster, StaffAssignmentMaster } from "@/data/types";
import type { DoughBatchPlan, ScheduleRow } from "@/lib/production";
import { templateFor, type CardField, type CardTemplate } from "./template";

/** 許す幅が登録されていないときの値 */
export const DEFAULT_KNEAD_TOLERANCE_C = 2;
export const DEFAULT_BAKE_TOLERANCE_C = 10;

/** 製品カードに行を出す工程（待つだけの工程＝発酵・ベンチ・ホイロ・冷却などは出さない） */
export const CARD_STEP_KEYS: ProcessStepKey[] = ["weigh", "mix", "divide", "shape", "topping", "bake", "freeze", "slice", "pack", "metal_check", "case_pack"];
const STEP_NAME: Partial<Record<ProcessStepKey, string>> = {
  weigh: "計量", mix: "ミキサー", divide: "分割", shape: "成型", topping: "トッピング", bake: "焼成", freeze: "急速冷凍", slice: "スライス", pack: "包装", metal_check: "金属検査", case_pack: "箱詰め",
};

export interface Weather {
  /** 晴れ・くもり・雨 など */
  label: string;
  tempC?: number;
  humidity?: number;
  /** どの時刻の値か（"05:00"） */
  at?: string;
  source: string;
}

export interface CardItem {
  productId: string;
  name: string;
  /** 1個の重さ（g・分割の重さ） */
  gram: number;
  orders: number;
  /** 仕込数（ロス込み） */
  prep: number;
  /** 焼成の目安（商品のマスタ。登録が無ければ空） */
  bakeTempC?: number;
  bakeMinutes?: number;
  bakeToleranceC?: number;
}

/** 工程の行（アプリが入れる所） */
export interface CardProcess {
  /** 工程のキー（工程のマスタのキー、または形で足した工程 "x-…"） */
  key: string;
  name: string;
  /** 工程表の予定（"4:10" / "前日 21:30"） */
  plannedStart?: string;
  plannedEnd?: string;
  /** 配置（"夜班 2人"） */
  staffHint?: string;
  /** この工程で確かめる温度（工程のマスタ） */
  temp?: { target?: number; min?: number; max?: number };
  /** CCP（重要管理点） */
  ccp?: boolean;
  /** 書く欄（第3版の形から。無ければ 時刻・担当・温度の基準があれば温度） */
  fields?: CardField[];
  /** この工程のロスを製品の表に書く（見出し） */
  lossLabel?: string;
  qtyLabel?: string;
  checkLabel?: string;
}

/** アプリが入れる所 */
export interface CardBase {
  date: string;
  productionDate: string;
  weekday: string;
  key: string;
  doughId: string;
  doughName: string;
  line: "bread" | "pizza";
  doughKg: number;
  batches: number;
  batchKg?: number;
  items: CardItem[];
  /** 工程の行（第2版） */
  processes?: CardProcess[];
  /** 使った形（第3版） */
  template?: { id: string; name: string };
  /** 目標の捏上温度（生地のマスタ。登録が無ければ空）と許す幅 */
  targetKneadC?: number;
  kneadToleranceC?: number;
  yeast?: { name: string; receivedDate?: string };
  weather?: Weather;
  // ── 前の版（保存してあるカードを読むため） ──
  planned?: { mix?: string; divideStart?: string; divideEnd?: string; bakeStart?: string; bakeEnd?: string };
  staff?: { mix?: string; divide?: string; bake?: string; pack?: string };
  bakeGuide?: { tempC?: number; minutes?: number; text: string };
}

export type Check = "" | "ok" | "ng";

export interface CardItemInput {
  made?: number;
  bakeTempC?: number;
  bakeMinutes?: number;
  packed?: number;
  loss?: number;
  stock?: number;
  metal?: Check;
  /** 2回目からの金属検査（流すたびに。ミキサーの回数ぶん。⑧） */
  metalRuns?: Check[];
  sensory?: Check;
  /** 工程ごとのロス数（キー＝工程。第3版）。前の版の loss は包装のロスとして読む */
  losses?: Record<string, number>;
}

/** ミキサー1回分（同じ生地をまとめてこねる。回ごとに1行） */
export interface MixInput {
  waterTempC?: number;
  kneadTime?: string;
  kneadTempC?: number;
  staff?: string;
}

/** 工程1つ分 */
export interface StepInput {
  start?: string;
  end?: string;
  staff?: string;
  /** 確かめた温度（急速冷凍の庫内温度など） */
  tempC?: number;
  /** 数（冷却した数・ケース数など） */
  qty?: number;
  /** ○× */
  check?: Check;
}

/** 現場で入れる所 */
export interface CardInput {
  roomTempC?: number;
  roomHumidity?: number;
  writer?: string;
  yeastReceived?: string;
  yeastExpiry?: string;
  /** 工程ごと（第2版） */
  steps?: Record<string, StepInput>;
  /** ミキサーの回ごと */
  mixes?: MixInput[];
  items: Record<string, CardItemInput>;
  approvedBy?: string;
  approvedAt?: string;
  note?: string;
  // ── 前の版 ──
  waterTempC?: number;
  kneadTempC?: number;
  kneadTime?: string;
  mixStaff?: string;
  divideStart?: string;
  divideEnd?: string;
  divideStaff?: string;
  bakeStart?: string;
  bakeEnd?: string;
  bakeStaff?: string;
  packStaff?: string;
}

export interface Problem {
  /** どの欄か（"mixes.0.kneadTempC"・"steps.freeze.tempC"・"items.P01.metal" など） */
  field: string;
  message: string;
}

const fmt = (min: number) => {
  const prev = min < 0;
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${prev ? "前日 " : ""}${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};

const inWindow = (minute: number, from: string, to: string) => {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  const hm = (x: string) => Number(x.split(":")[0]) * 60 + Number(x.split(":")[1] || 0);
  const f = hm(from);
  const t = hm(to);
  return f <= t ? m >= f && m < t : m >= f || m < t;
};

/** その時刻にいる班で、その工程に配置した人数（"夜班 2人"）。班が無ければ undefined */
export function staffText(
  line: "bread" | "pizza",
  stepKey: string,
  minute: number | undefined,
  shifts: ShiftMaster[],
  assignments: StaffAssignmentMaster[],
  weekday: number,
): string | undefined {
  if (minute == null) return undefined;
  const sh = shifts.filter((s) => (s.line === line || s.line === "common") && (!s.weekdays?.length || s.weekdays.includes(weekday)) && inWindow(minute, s.from, s.to));
  const parts = sh.flatMap((s) => {
    const a = assignments.find((x) => x.shiftId === s.id && x.line === line && x.stepKey === stepKey);
    return a && a.people > 0 ? [`${s.name} ${a.people}人`] : [];
  });
  return parts.length ? parts.join("・") : sh.length ? sh.map((s) => s.name).join("・") : undefined;
}

/** 製造計画の1つの生地から、カードのアプリが入れる所を作る */
export function buildCardBase(args: {
  date: string;
  productionDate: string;
  dough: DoughBatchPlan;
  schedule?: ScheduleRow;
  steps: ProcessStepMaster[];
  shifts: ShiftMaster[];
  assignments: StaffAssignmentMaster[];
  doughs?: DoughMaster[];
  products?: ProductMaster[];
  /** 製品カードの形（第3版）。この生地に使う形があれば、工程の行はその形から */
  templates?: CardTemplate[];
  yeast?: { name: string; receivedDate?: string };
  weather?: Weather;
}): CardBase {
  const { dough, schedule } = args;
  const dow = new Date(`${args.productionDate}T12:00:00Z`).getUTCDay();
  const loss = dough.lossRate > 0 && dough.lossRate < 1 ? dough.lossRate : 0;
  const dm = args.doughs?.find((d) => d.id === dough.doughId);
  const productOf = new Map((args.products ?? []).map((p) => [p.id, p]));

  // 工程の行: 工程のマスタ（この生地）の順。無ければ工程表の順。包装・金属検査は無くても足す（包装のところでやる）
  const master = args.steps.filter((s) => s.doughId === dough.doughId).sort((a, b) => a.seq - b.seq);
  const keys: ProcessStepKey[] = [];
  for (const k of [...master.map((s) => s.key), ...(schedule?.steps.map((s) => s.key as ProcessStepKey) ?? [])]) {
    if (CARD_STEP_KEYS.includes(k) && !keys.includes(k)) keys.push(k);
  }
  if (!keys.length) keys.push("weigh", "mix", "divide", "shape", "bake");
  for (const k of ["pack", "metal_check"] as const) if (!keys.includes(k)) keys.push(k);
  const at = (k: string, which: "start" | "end") => {
    const s = schedule?.steps.find((x) => x.key === k && x.end > x.start);
    return s ? (s.prevDay ? s[which] - 1440 : s[which]) : undefined;
  };
  const tpl = args.templates ? templateFor(args.templates, dough.doughId, dough.line) : undefined;
  const fromTemplate: CardProcess[] | undefined = tpl?.steps.map((ts) => {
    const m = master.find((s) => s.key === ts.key);
    const st = at(ts.key, "start");
    const en = at(ts.key, "end");
    const hint = staffText(dough.line, ts.key, st, args.shifts, args.assignments, dow);
    const mt = m && (m.tempTargetC != null || m.tempMinC != null || m.tempMaxC != null) ? { target: m.tempTargetC, min: m.tempMinC, max: m.tempMaxC } : undefined;
    const temp = ts.fields.includes("temp") ? (ts.temp ?? mt) : undefined;
    return {
      key: ts.key, name: ts.name, fields: ts.fields,
      ...(st != null ? { plannedStart: fmt(st) } : {}), ...(en != null ? { plannedEnd: fmt(en) } : {}),
      ...(hint ? { staffHint: hint } : {}), ...(temp ? { temp } : {}), ...(ts.ccp || m?.ccp ? { ccp: true } : {}),
      ...(ts.lossLabel ? { lossLabel: ts.lossLabel } : {}), ...(ts.qtyLabel ? { qtyLabel: ts.qtyLabel } : {}), ...(ts.checkLabel ? { checkLabel: ts.checkLabel } : {}),
    };
  });
  const processes: CardProcess[] = fromTemplate ?? keys.map((k) => {
    const m = master.find((s) => s.key === k);
    const st = at(k, "start");
    const en = at(k, "end");
    const hint = staffText(dough.line, k, st, args.shifts, args.assignments, dow);
    const temp = m && (m.tempTargetC != null || m.tempMinC != null || m.tempMaxC != null) ? { target: m.tempTargetC, min: m.tempMinC, max: m.tempMaxC } : undefined;
    return {
      key: k, name: m?.name ?? STEP_NAME[k] ?? k,
      ...(st != null ? { plannedStart: fmt(st) } : {}), ...(en != null ? { plannedEnd: fmt(en) } : {}),
      ...(hint ? { staffHint: hint } : {}), ...(temp ? { temp } : {}), ...(m?.ccp || k === "metal_check" ? { ccp: true } : {}),
    };
  });

  return {
    date: args.date,
    productionDate: args.productionDate,
    weekday: "日月火水木金土"[dow],
    key: dough.key,
    doughId: dough.doughId,
    doughName: dough.name + (dough.waveName ? `（${dough.waveName}）` : ""),
    line: dough.line,
    doughKg: dough.doughKg,
    batches: dough.batches,
    batchKg: dough.batchKg,
    items: dough.items.map((i) => {
      const p = productOf.get(i.productId);
      return {
        productId: i.productId, name: i.name, gram: i.doughGram, orders: i.pieces, prep: Math.ceil(i.pieces / (1 - loss)),
        ...(p?.bakeTempC != null ? { bakeTempC: p.bakeTempC } : {}), ...(p?.bakeMinutes != null ? { bakeMinutes: p.bakeMinutes } : {}),
        ...(p?.bakeToleranceC != null ? { bakeToleranceC: p.bakeToleranceC } : {}),
      };
    }),
    processes,
    ...(tpl ? { template: { id: tpl.id, name: tpl.name } } : {}),
    ...(dm?.kneadTargetC != null ? { targetKneadC: dm.kneadTargetC, kneadToleranceC: dm.kneadToleranceC ?? DEFAULT_KNEAD_TOLERANCE_C } : {}),
    ...(args.yeast ? { yeast: args.yeast } : {}),
    ...(args.weather ? { weather: args.weather } : {}),
  };
}

/** 工程の行（前の版で保存したカードは、分割・焼成・包装の行を作る） */
export function processesOf(base: CardBase): CardProcess[] {
  if (base.processes?.length) return base.processes;
  return [
    { key: "mix", name: "ミキサー", plannedStart: base.planned?.mix, staffHint: base.staff?.mix },
    { key: "divide", name: "分割", plannedStart: base.planned?.divideStart, plannedEnd: base.planned?.divideEnd, staffHint: base.staff?.divide },
    { key: "bake", name: "焼成", plannedStart: base.planned?.bakeStart, plannedEnd: base.planned?.bakeEnd, staffHint: base.staff?.bake },
    { key: "pack", name: "包装", staffHint: base.staff?.pack },
    { key: "metal_check", name: "金属検査", ccp: true },
  ];
}

/** 工程ごとの入力（前の版の divideStart などは、その工程に読みかえる） */
export function stepsOf(input: CardInput): Record<string, StepInput> {
  const legacy: Record<string, StepInput> = {};
  const put = (k: string, v: StepInput) => {
    const clean = Object.fromEntries(Object.entries(v).filter(([, x]) => x != null && x !== "")) as StepInput;
    if (Object.keys(clean).length) legacy[k] = clean;
  };
  put("divide", { start: input.divideStart, end: input.divideEnd, staff: input.divideStaff });
  put("bake", { start: input.bakeStart, end: input.bakeEnd, staff: input.bakeStaff });
  put("pack", { staff: input.packStaff });
  const out: Record<string, StepInput> = { ...legacy };
  for (const [k, v] of Object.entries(input.steps ?? {})) out[k] = { ...legacy[k], ...v };
  return out;
}

/** 工程の行の書く欄（第3版の形が無ければ 時刻・担当、温度の基準があれば温度も） */
export function fieldsOf(p: CardProcess): CardField[] {
  return p.fields ?? ["time", "staff", ...(p.temp ? (["temp"] as const) : [])];
}

/** 製品の表のロスの列（第3版の形の lossLabel。無い前の版は「ロス」1列＝包装） */
export function lossColumns(base: CardBase): { key: string; label: string }[] {
  const cols = processesOf(base).flatMap((p) => (p.lossLabel ? [{ key: p.key, label: p.lossLabel }] : []));
  return cols.length ? cols : [{ key: "pack", label: "ロス" }];
}

/** その工程のロス数（前の版の loss は包装のロス） */
export function lossOf(x: CardItemInput | undefined, key: string): number | undefined {
  const v = x?.losses?.[key];
  if (v != null) return v;
  return key === "pack" ? x?.loss : undefined;
}

/** ロスの合計 */
export function totalLoss(base: CardBase, x: CardItemInput | undefined): number | undefined {
  const vals = lossColumns(base).map((c) => lossOf(x, c.key)).filter((v): v is number => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) : undefined;
}

/** ミキサーの回ごとの入力（前の形＝1回分だけの kneadTempC などは1回目に読みかえる） */
export function mixesOf(input: CardInput): MixInput[] {
  if (input.mixes?.length) return input.mixes;
  if (input.kneadTempC != null || input.waterTempC != null || input.kneadTime || input.mixStaff) {
    return [{ waterTempC: input.waterTempC, kneadTime: input.kneadTime, kneadTempC: input.kneadTempC, staff: input.mixStaff }];
  }
  return [];
}

/** 捏上温度の基準（生地のマスタ）。登録が無ければ undefined（赤にしない） */
export function kneadRule(base: CardBase): { target: number; tol: number } | undefined {
  if (base.targetKneadC == null) return undefined;
  return { target: base.targetKneadC, tol: base.kneadToleranceC ?? DEFAULT_KNEAD_TOLERANCE_C };
}

/** 焼成の基準（商品のマスタ。前の版で保存したカードは、そのときの目安） */
export function bakeRule(base: CardBase, item: CardItem): { temp?: number; minutes?: number; tol: number } | undefined {
  const temp = item.bakeTempC ?? base.bakeGuide?.tempC;
  const minutes = item.bakeMinutes ?? base.bakeGuide?.minutes;
  if (temp == null && minutes == null) return undefined;
  return { temp, minutes, tol: item.bakeToleranceC ?? DEFAULT_BAKE_TOLERANCE_C };
}

/** 終わりが始めより前か（0:00 をまたぐのはよい。12時間より長くなる並びだけ「前」とみなす） */
function backwards(from?: string, to?: string) {
  if (!from || !to) return false;
  const m = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5));
  return (m(to) - m(from) + 1440) % 1440 > 12 * 60;
}

/** 目標から外れている所（赤にする） */
export function checkCard(base: CardBase, input: CardInput): Problem[] {
  const p: Problem[] = [];
  const kr = kneadRule(base);
  mixesOf(input).forEach((m, i) => {
    if (kr && m.kneadTempC != null && Math.abs(m.kneadTempC - kr.target) > kr.tol) {
      p.push({ field: `mixes.${i}.kneadTempC`, message: `${i + 1}回目の捏上温度が目標（${kr.target}℃ ±${kr.tol}）から外れています` });
    }
  });
  if (input.yeastExpiry && input.yeastExpiry < base.productionDate) p.push({ field: "yeastExpiry", message: "イーストの賞味期限が過ぎています" });
  const steps = stepsOf(input);
  for (const pr of processesOf(base)) {
    const s = steps[pr.key];
    if (!s) continue;
    if (backwards(s.start, s.end)) p.push({ field: `steps.${pr.key}.end`, message: `${pr.name}の終わりが始めより前です` });
    if (s.check === "ng") p.push({ field: `steps.${pr.key}.check`, message: `${pr.name}: ${pr.checkLabel ?? "確認"}が × です` });
    if (pr.temp && s.tempC != null && ((pr.temp.min != null && s.tempC < pr.temp.min) || (pr.temp.max != null && s.tempC > pr.temp.max))) {
      p.push({ field: `steps.${pr.key}.tempC`, message: `${pr.name}の温度が管理の範囲（${pr.temp.min ?? ""}〜${pr.temp.max ?? ""}℃）から外れています` });
    }
  }
  for (const it of base.items) {
    const x = input.items[it.productId];
    if (!x) continue;
    const f = (k: string) => `items.${it.productId}.${k}`;
    const br = bakeRule(base, it);
    if (br?.temp != null && x.bakeTempC != null && Math.abs(x.bakeTempC - br.temp) > br.tol) {
      p.push({ field: f("bakeTempC"), message: `${it.name}: 焼成温度が目安（${br.temp}℃ ±${br.tol}）から外れています` });
    }
    if (x.metal === "ng") p.push({ field: f("metal"), message: `${it.name}: 金属検査が × です（責任者に知らせる）` });
    (x.metalRuns ?? []).forEach((c, i) => {
      if (c === "ng") p.push({ field: f("metal"), message: `${it.name}: ${i + 2}回目の金属検査が × です（責任者に知らせる）` });
    });
    if (x.sensory === "ng") p.push({ field: f("sensory"), message: `${it.name}: 官能検査が × です` });
    if (x.packed != null && x.packed < it.orders) p.push({ field: f("packed"), message: `${it.name}: 製品数が注文数（${it.orders}）より ${it.orders - x.packed} 少ない` });
  }
  return p;
}

/** 記入の進み具合 */
export function cardStatus(base: CardBase, input?: CardInput): "empty" | "writing" | "done" | "approved" {
  if (!input) return "empty";
  if (input.approvedBy) return "approved";
  const m0 = mixesOf(input)[0] ?? {};
  const need = [m0.kneadTempC, m0.waterTempC, input.writer, ...base.items.flatMap((i) => [input.items[i.productId]?.packed, input.items[i.productId]?.metal || undefined])];
  if (need.every((v) => v != null && v !== "")) return "done";
  const filled = (o: object | undefined) => !!o && Object.values(o).some((v) => v != null && v !== "");
  const any =
    Object.entries(input).some(([k, v]) => !["items", "steps", "mixes"].includes(k) && v != null && v !== "") ||
    Object.values(input.items).some(filled) ||
    mixesOf(input).some(filled) ||
    Object.values(input.steps ?? {}).some(filled);
  return any ? "writing" : "empty";
}
