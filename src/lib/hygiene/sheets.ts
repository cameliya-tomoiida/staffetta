// 衛生管理のチェックシート（⑦の(21)）。純関数とシートの決まり（形・項目・基準）。
// 工場で毎月印刷して現場に置いている紙を、5つの形にまとめる:
//   temp  温度の記録（1日2回・管理範囲から外れたら措置を書く）  例: 焼成窯・急速冷凍庫・原料保管庫
//   clean 点検清掃（頻度から ○＝計画 を入れ、実施したら ●）     例: 製造機械点検清掃計画（区域ごと）
//   check 毎日のチェック（✓ と担当者）                           例: 備品管理表・最終退社者スイッチ確認
//   log   記録の表（1行ずつ足す）                                 例: 金属検出機の動作確認・製造日報
//   label ラベル（使用可能日）                                     例: 材料使用日表
// 1枚＝1か月（A4 横）。月を選ぶと、日付・曜日・週・計画の ○ をアプリが入れる。

import { CLEAN_SHEETS } from "./default-clean";

export type SheetKind = "temp" | "clean" | "check" | "log" | "label";
export type Freq = "daily" | "weekly" | "biweekly" | "monthly" | "twice";

export interface SheetItem {
  id: string;
  name: string;
  /** 備考（何をするか・どこか） */
  note?: string;
  /** 点検清掃の頻度 */
  freq?: Freq;
  /** 週1・2週に1のときの曜日（0=日〜6=土）。空なら水曜 */
  weekday?: number;
  /** 月1のときの日。空なら最初の営業日 */
  monthDay?: number;
  /** 担当（仕込・ピザ・資材 など） */
  owner?: string;
  /** 備品の数 */
  qty?: number;
  /** グループの見出し（区域・設備） */
  group?: string;
}

export interface TempRule {
  unit: string;
  /** 設定温度 */
  set?: number;
  /** 管理範囲 */
  min?: number;
  max?: number;
  /** 印刷の目盛り（上から） */
  scale?: number[];
  /** 湿度も書く（原料保管庫） */
  humidity?: boolean;
  /** 1日の回数（①午前・②午後） */
  perDay: 1 | 2;
}

export interface LogColumn {
  key: string;
  label: string;
  type: "text" | "number" | "okng" | "date";
  /** 印刷の幅（割合） */
  width?: number;
}

export interface SheetDef {
  id: string;
  title: string;
  kind: SheetKind;
  /** 区域・ライン（ピザ・パン など） */
  area?: string;
  /** 用紙の上に出す決まり（基準・やり方） */
  rule?: string;
  /** 記入する曜日（0=日〜6=土）。空なら毎日 */
  weekdays?: number[];
  temp?: TempRule;
  items?: SheetItem[];
  columns?: LogColumn[];
  /** 使う（いいえにすると一覧・印刷から外す） */
  active?: boolean;
}

/** 1日分 */
export interface Day {
  date: string;
  /** 日 */
  d: number;
  weekday: number;
  /** その月の何週目（1〜6。月曜はじまり） */
  week: number;
}

export const WD = "日月火水木金土";

/** その月の日付（"2026-11"） */
export function monthDays(month: string): Day[] {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstWd = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  // 月曜はじまりで、1日が入る週を第1週
  const offset = (firstWd + 6) % 7;
  return Array.from({ length: n }, (_, i) => {
    const d = i + 1;
    const weekday = (firstWd + i) % 7;
    return { date: `${month}-${String(d).padStart(2, "0")}`, d, weekday, week: Math.floor((offset + i) / 7) + 1 };
  });
}

/** 記入する日（曜日と休業日で絞る） */
export function runDays(def: Pick<SheetDef, "weekdays">, month: string, holidays: string[] = []): Day[] {
  const off = new Set(holidays);
  return monthDays(month).filter((x) => (!def.weekdays?.length || def.weekdays.includes(x.weekday)) && !off.has(x.date));
}

/** 点検清掃の計画（その日に ○ を入れるか） */
export function isPlanned(item: SheetItem, day: Day, run: Day[]): boolean {
  if (!run.some((r) => r.date === day.date)) return false;
  const f = item.freq ?? "daily";
  if (f === "daily") return true;
  const wd = item.weekday ?? 3;
  if (f === "weekly") {
    if (day.weekday === wd) return true;
    // その週の決めた曜日が、この月の中で休みのときだけ、その週の最後の記入日にずらす（月の境の週はずらさない）
    const inWeek = monthDays(day.date.slice(0, 7)).find((x) => x.week === day.week && x.weekday === wd);
    if (!inWeek || run.some((r) => r.date === inWeek.date)) return false;
    return day.date === run.filter((r) => r.week === day.week).at(-1)?.date;
  }
  if (f === "biweekly") return day.weekday === wd && day.week % 2 === 0;
  // 週2: 月曜と木曜
  if (f === "twice") return day.weekday === 1 || day.weekday === 4;
  // 月1: 決めた日（その日が休みなら次の営業日）、空なら最初の営業日
  const target = item.monthDay ? run.find((r) => r.d >= item.monthDay!) : run[0];
  return target?.date === day.date;
}

export const KIND_LABEL: Record<SheetKind, string> = { temp: "温度の記録", clean: "点検・清掃", check: "毎日のチェック", log: "記録の表", label: "ラベル" };
export const FREQ_LABEL: Record<Freq, string> = { daily: "毎日", weekly: "1回/週", biweekly: "1回/2週", monthly: "1回/月", twice: "2回/週" };

// ───────── 記録（入力） ─────────

export type Check = "" | "ok" | "ng";

export interface TempEntry {
  /** 1つ目の時刻（前の版の ①午前） */
  am?: number;
  /** 2つ目の時刻（前の版の ②午後） */
  pm?: number;
  humAm?: number;
  humPm?: number;
  /** 3つ目からの時刻（毎時など。⑧ 記録する時刻の数だけ欄ができる）。添え字は時刻の順（0・1 は am・pm を使う） */
  vals?: (number | null)[];
  hums?: (number | null)[];
  /** 異常時の措置 */
  action?: string;
  who?: string;
}

/** 温度の欄の名前（記録する時刻があれば、その時刻。無ければ ①午前・②午後） */
export function tempSlots(rule: Pick<TempRule, "perDay"> | undefined, times?: string[]): string[] {
  if (times?.length) return times;
  return rule?.perDay === 2 ? ["①午前", "②午後"] : ["①午前"];
}
/** i 番目の時刻の温度・湿度 */
export const slotVal = (e: TempEntry | undefined, i: number): number | undefined => (i === 0 ? e?.am : i === 1 ? e?.pm : (e?.vals?.[i] ?? undefined));
export const slotHum = (e: TempEntry | undefined, i: number): number | undefined => (i === 0 ? e?.humAm : i === 1 ? e?.humPm : (e?.hums?.[i] ?? undefined));
/** i 番目の時刻に値を入れた新しい記録 */
export function withSlot(e: TempEntry | undefined, i: number, v: number | undefined, hum = false): TempEntry {
  const x: TempEntry = { ...e };
  if (i < 2) {
    const k = hum ? (i === 0 ? "humAm" : "humPm") : i === 0 ? "am" : "pm";
    if (v == null) delete x[k];
    else x[k] = v;
    return x;
  }
  const arr = [...((hum ? x.hums : x.vals) ?? [])];
  while (arr.length <= i) arr.push(null);
  arr[i] = v ?? null;
  if (hum) x.hums = arr;
  else x.vals = arr;
  return x;
}
/** その日の温度の値（全部の時刻） */
export const allVals = (e: TempEntry | undefined): number[] => [e?.am, e?.pm, ...(e?.vals ?? []).slice(2)].filter((v): v is number => v != null);

export interface SheetRecord {
  /** temp: 日付 → 値 */
  temps?: Record<string, TempEntry>;
  /** clean・check: "項目ID|日付" → した人（空ならした） */
  done?: Record<string, string>;
  /** その日のサイン（日付 → 名前） */
  signs?: Record<string, string>;
  /** log: 行 */
  rows?: Record<string, string | number>[];
  /** label: 使用可能日の一覧 */
  labels?: string[];
  /** 責任者の確認（月ごと） */
  approvedBy?: string;
  approvedAt?: string;
}

/** 温度が管理範囲の外か */
export function outOfRange(rule: TempRule | undefined, v: number | undefined): boolean {
  if (!rule || v == null) return false;
  return (rule.min != null && v < rule.min) || (rule.max != null && v > rule.max);
}

/** その月の困りごと（範囲の外で措置が無い・計画したのにしていない（過ぎた日）・金属検出の×） */
export function sheetProblems(def: SheetDef, rec: SheetRecord | undefined, month: string, today: string, holidays: string[] = []): string[] {
  const out: string[] = [];
  const run = runDays(def, month, holidays);
  if (def.kind === "temp") {
    for (const d of run) {
      const t = rec?.temps?.[d.date];
      const bad = allVals(t).some((v) => outOfRange(def.temp, v));
      if (bad && !t?.action) out.push(`${d.d}日: 管理範囲の外です。異常時の措置を書いてください`);
      if (d.date < today && !allVals(t).length) out.push(`${d.d}日: 記入がありません`);
    }
  }
  if (def.kind === "clean") {
    const miss = run.filter((d) => d.date < today).flatMap((d) => (def.items ?? []).filter((it) => isPlanned(it, d, run) && rec?.done?.[`${it.id}|${d.date}`] == null).map((it) => `${d.d}日 ${it.name}`));
    if (miss.length) out.push(`計画したのに、していない（${miss.length}件）: ${miss.slice(0, 5).join("・")}${miss.length > 5 ? " …" : ""}`);
  }
  if (def.kind === "log") {
    (rec?.rows ?? []).forEach((r, i) => {
      const ng = (def.columns ?? []).filter((c) => c.type === "okng" && r[c.key] === "ng");
      if (ng.length && !String(r.action ?? r.note ?? "").trim()) out.push(`${i + 1}行目: ×があります。措置を書いてください`);
    });
  }
  return out;
}

// ───────── はじめのシート（今の紙から。会社名・取引先名は入れない） ─────────
// 製品が通る道のチェック（焼成温度・急速冷凍の温度・金属検査・包装・ミキサー・製造日報）は製品カード（/cards）に入れた（担当者・紙を減らす）。
// ここは製品にひも付かないもの: 保管庫の温度・点検清掃（区域ごと。米飯も。売店は使っていないので作らない）・備品・最終退社者・ラベル。

const it = (id: string, name: string, x: Partial<SheetItem> = {}): SheetItem => ({ id, name, ...x });

export const DEFAULT_SHEETS: SheetDef[] = [
  {
    id: "temp-storage", title: "原料保管庫 温度管理表（常温）", kind: "temp", area: "原料",
    rule: "常温保管（直射日光・高温多湿を避ける）。目安：室温 28℃以下。異常があれば責任者へ報告のうえ措置を記録する。",
    temp: { unit: "℃", max: 28, humidity: true, perDay: 2 },
  },
  {
    id: "temp-freezer-storage", title: "保管冷凍庫 温度管理表", kind: "temp", area: "全体",
    rule: "冷凍保管の目安：−18℃以下（基準は工場の決まりに合わせて、画面で直す）。外れたら扉を開閉せず1時間後に再確認し、改善しなければ移動・修理依頼。",
    temp: { unit: "℃", max: -18, scale: [-14, -15, -16, -17, -18, -19, -20, -21, -22, -23, -24], perDay: 2 },
  },
  ...CLEAN_SHEETS,
  {
    id: "check-tools", title: "備品管理表（ピザ焼成・真空）", kind: "check", area: "ピザ", weekdays: [1, 2, 3, 4, 5],
    rule: "始業時・終業時に数がそろっているか確かめ、そろっていれば ✓（異物混入の防止）。",
    items: [
      it("t1", "ピザ用計量", { qty: 1, group: "ピザ焼成区域" }), it("t2", "ヘラ", { qty: 2, group: "ピザ焼成区域" }), it("t3", "トング", { qty: 1, group: "ピザ焼成区域" }),
      it("t4", "スプーン 大", { qty: 3, group: "ピザ焼成区域" }), it("t5", "ピザカッター", { qty: 1, group: "ピザ焼成区域" }), it("t6", "はさみ", { qty: 1, group: "ピザ焼成区域" }),
      it("t7", "缶切り", { qty: 1, group: "ピザ焼成区域" }), it("t8", "メジャー", { qty: 1, group: "ピザ焼成区域" }), it("t9", "ドライバー", { qty: 1, group: "ピザ焼成区域" }),
      it("t10", "バックシーラー", { qty: 1, group: "真空区域" }), it("t11", "ガムテープ", { qty: 1, group: "真空区域" }), it("t12", "テープ", { qty: 1, group: "真空区域" }),
      it("t13", "ラベラー", { qty: 1, group: "真空区域" }), it("t14", "油性マジック", { qty: 1, group: "真空区域" }), it("t15", "ボールペン", { qty: 2, group: "真空区域" }),
      it("t16", "アルコール", { qty: 1, group: "真空区域" }),
    ],
  },
  {
    id: "check-last-out", title: "最終退社者スイッチ確認表", kind: "check", area: "全体",
    rule: "最後に出る人が、スイッチが切れているか確かめて ✓。",
    items: [
      it("s1", "照明①", { note: "窯前" }), it("s2", "照明②", { note: "ラック置き場" }), it("s3", "照明③", { note: "シーター横" }), it("s4", "照明④", { note: "出入口" }),
      it("s5", "照明⑤", { note: "包装室" }), it("s6", "エアコン", { note: "ピザ台 2か所" }), it("s7", "換気扇①", { note: "窯" }), it("s8", "換気扇②", { note: "ピザ窯" }),
      it("s9", "換気扇③", { note: "洗浄機" }), it("s10", "ベルトコンベアー", { note: "ベルトコンベアー下" }), it("s11", "エアー", { note: "スライサー室" }),
    ],
  },
  { id: "label-use-by", title: "材料使用日表（ラベル）", kind: "label", area: "全体", rule: "使用可能日を過ぎたものは破棄すること。切って容器に貼る。" },
];
