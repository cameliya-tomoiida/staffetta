// 製品カード（⑦の(13)）。工場で毎日書いている紙（生地ごと・日ごとに1枚）をタブレットで入力する。純関数だけ。
// 紙の並び: 日付・天候・室温・湿度 → 計量（生地名・記入者・イーストの納入日/賞味期限）→ ミキサー（水温・捏上温度・捏上時間・担当者）
//          → 分割・成型（開始/終了・担当者・①〜⑥ 製品名/重量g/注文数/仕込数/製品数）→ 焼成（開始/終了・担当者・①〜⑥ 温度/時間）
//          → 包装（①〜⑥ 製品数/ロス数/在庫/金属検査/官能検査・担当者）→ 責任者確認
// 分かっていること（CardBase）はアプリが入れる。現場で測ること（CardInput）だけ人が入れる。
import type { ProcessStepMaster, ShiftMaster, StaffAssignmentMaster } from "@/data/types";
import type { DoughBatchPlan, ScheduleRow } from "@/lib/production";

/** 目標のこね上げ温度（℃）と、許す幅 */
export const TARGET_KNEAD_C = 26;
export const KNEAD_TOLERANCE_C = 2;
/** 焼成温度が目安からどれだけ外れたら赤にするか（℃） */
export const BAKE_TOLERANCE_C = 10;

export interface Weather {
  /** 晴れ・くもり・雨 など */
  label: string;
  /** 外の気温（℃） */
  tempC?: number;
  /** 外の湿度（％） */
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
  /** 注文数 */
  orders: number;
  /** 仕込数（ロス込み） */
  prep: number;
}

/** アプリが入れる所 */
export interface CardBase {
  /** 製造計画の日付（/plan の日付） */
  date: string;
  /** 作る日 */
  productionDate: string;
  /** 曜日（日〜土） */
  weekday: string;
  /** 生地のキー（便で分けたら "DG01#2"） */
  key: string;
  doughId: string;
  doughName: string;
  line: "bread" | "pizza";
  /** 生地 kg・ミキサーの回数 */
  doughKg: number;
  batches: number;
  items: CardItem[];
  /** 工程表の予定（"4:10" / "前日 21:30"） */
  planned: { mix?: string; divideStart?: string; divideEnd?: string; bakeStart?: string; bakeEnd?: string };
  /** 担当（班と配置の人数から。"夜班 2人"） */
  staff: { mix?: string; divide?: string; bake?: string; pack?: string };
  /** 使うイースト（レシピから）と、いちばん新しい入荷の日 */
  yeast?: { name: string; receivedDate?: string };
  targetKneadC: number;
  /** 焼成の目安（工程のマスタのメモから。"200℃ 12分"） */
  bakeGuide?: { tempC?: number; minutes?: number; text: string };
  weather?: Weather;
}

export type Check = "" | "ok" | "ng";

export interface CardItemInput {
  /** 分割・成型の製品数 */
  made?: number;
  bakeTempC?: number;
  bakeMinutes?: number;
  /** 包装 */
  packed?: number;
  loss?: number;
  stock?: number;
  metal?: Check;
  sensory?: Check;
}

/** 現場で入れる所 */
export interface CardInput {
  roomTempC?: number;
  roomHumidity?: number;
  writer?: string;
  yeastReceived?: string;
  yeastExpiry?: string;
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
  /** 商品ごと（CardBase.items と同じ productId） */
  items: Record<string, CardItemInput>;
  /** 責任者の確認 */
  approvedBy?: string;
  approvedAt?: string;
  note?: string;
}

export interface Problem {
  /** どの欄か（"kneadTempC"・"items.P01.metal" など） */
  field: string;
  message: string;
}

const fmt = (min: number) => {
  const prev = min < 0;
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${prev ? "前日 " : ""}${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};

/** 工程のマスタのメモ（"200℃ 12分" "上火210/下火190℃・15分"）から焼成の目安を読む */
export function parseBakeGuide(note?: string): CardBase["bakeGuide"] {
  if (!note) return undefined;
  const t = /(\d{2,3})\s*(?:℃|度)/.exec(note);
  const m = /(\d{1,3})\s*分/.exec(note);
  return { text: note, ...(t ? { tempC: Number(t[1]) } : {}), ...(m ? { minutes: Number(m[1]) } : {}) };
}

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
  yeast?: { name: string; receivedDate?: string };
  weather?: Weather;
}): CardBase {
  const { dough, schedule } = args;
  const dow = new Date(`${args.productionDate}T12:00:00Z`).getUTCDay();
  const step = (k: string) => schedule?.steps.find((s) => s.key === k && s.end > s.start);
  const at = (k: string, which: "start" | "end") => {
    const s = step(k);
    return s ? (s.prevDay ? s[which] - 1440 : s[which]) : undefined;
  };
  const mix = at("mix", "start");
  const divS = at("divide", "start");
  const bakeS = at("bake", "start");
  const packS = at("pack", "start");
  const staff = (k: string, minute?: number) => staffText(dough.line, k, minute, args.shifts, args.assignments, dow);
  const bakeStep = args.steps.find((s) => s.doughId === dough.doughId && s.key === "bake");
  const loss = dough.lossRate > 0 && dough.lossRate < 1 ? dough.lossRate : 0;
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
    items: dough.items.map((i) => ({ productId: i.productId, name: i.name, gram: i.doughGram, orders: i.pieces, prep: Math.ceil(i.pieces / (1 - loss)) })),
    planned: {
      ...(mix != null ? { mix: fmt(mix) } : {}),
      ...(divS != null ? { divideStart: fmt(divS) } : {}),
      ...(at("divide", "end") != null ? { divideEnd: fmt(at("divide", "end")!) } : {}),
      ...(bakeS != null ? { bakeStart: fmt(bakeS) } : {}),
      ...(at("bake", "end") != null ? { bakeEnd: fmt(at("bake", "end")!) } : {}),
    },
    staff: {
      ...(staff("mix", mix) ? { mix: staff("mix", mix) } : {}),
      ...(staff("divide", divS) ? { divide: staff("divide", divS) } : {}),
      ...(staff("bake", bakeS) ? { bake: staff("bake", bakeS) } : {}),
      ...(staff("pack", packS) ? { pack: staff("pack", packS) } : {}),
    },
    ...(args.yeast ? { yeast: args.yeast } : {}),
    targetKneadC: TARGET_KNEAD_C,
    ...(parseBakeGuide(bakeStep?.note) ? { bakeGuide: parseBakeGuide(bakeStep?.note) } : {}),
    ...(args.weather ? { weather: args.weather } : {}),
  };
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
  if (input.kneadTempC != null && Math.abs(input.kneadTempC - base.targetKneadC) > KNEAD_TOLERANCE_C) {
    p.push({ field: "kneadTempC", message: `捏上温度が目標（${base.targetKneadC}℃ ±${KNEAD_TOLERANCE_C}）から外れています` });
  }
  if (input.yeastExpiry && input.yeastExpiry < base.productionDate) p.push({ field: "yeastExpiry", message: "イーストの賞味期限が過ぎています" });
  if (backwards(input.divideStart, input.divideEnd)) p.push({ field: "divideEnd", message: "分割の終わりが始めより前です" });
  if (backwards(input.bakeStart, input.bakeEnd)) p.push({ field: "bakeEnd", message: "焼成の終わりが始めより前です" });
  for (const it of base.items) {
    const x = input.items[it.productId];
    if (!x) continue;
    const f = (k: string) => `items.${it.productId}.${k}`;
    if (base.bakeGuide?.tempC != null && x.bakeTempC != null && Math.abs(x.bakeTempC - base.bakeGuide.tempC) > BAKE_TOLERANCE_C) {
      p.push({ field: f("bakeTempC"), message: `${it.name}: 焼成温度が目安（${base.bakeGuide.tempC}℃）から外れています` });
    }
    if (x.metal === "ng") p.push({ field: f("metal"), message: `${it.name}: 金属検査が × です（責任者に知らせる）` });
    if (x.sensory === "ng") p.push({ field: f("sensory"), message: `${it.name}: 官能検査が × です` });
    if (x.packed != null && x.packed < it.orders) p.push({ field: f("packed"), message: `${it.name}: 製品数が注文数（${it.orders}）より ${it.orders - x.packed} 少ない` });
  }
  return p;
}

/** 記入の進み具合 */
export function cardStatus(base: CardBase, input?: CardInput): "empty" | "writing" | "done" | "approved" {
  if (!input) return "empty";
  if (input.approvedBy) return "approved";
  const need = [input.kneadTempC, input.waterTempC, input.writer, ...base.items.flatMap((i) => [input.items[i.productId]?.packed, input.items[i.productId]?.metal || undefined])];
  if (need.every((v) => v != null && v !== "")) return "done";
  const any = Object.entries(input).some(([k, v]) => k !== "items" && v != null && v !== "") || Object.values(input.items).some((x) => Object.values(x).some((v) => v != null && v !== ""));
  return any ? "writing" : "empty";
}
