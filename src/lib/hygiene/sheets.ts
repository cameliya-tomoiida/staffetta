// 衛生管理のチェックシート（⑦の(21)）。純関数とシートの決まり（形・項目・基準）。
// 工場で毎月印刷して現場に置いている紙を、5つの形にまとめる:
//   temp  温度の記録（1日2回・管理範囲から外れたら措置を書く）  例: 焼成窯・急速冷凍庫・原料保管庫
//   clean 点検清掃（頻度から ○＝計画 を入れ、実施したら ●）     例: 製造機械点検清掃計画（区域ごと）
//   check 毎日のチェック（✓ と担当者）                           例: 備品管理表・最終退社者スイッチ確認
//   log   記録の表（1行ずつ足す）                                 例: 金属検出機の動作確認・製造日報
//   label ラベル（使用可能日）                                     例: 材料使用日表
// 1枚＝1か月（A4 横）。月を選ぶと、日付・曜日・週・計画の ○ をアプリが入れる。

export type SheetKind = "temp" | "clean" | "check" | "log" | "label";
export type Freq = "daily" | "weekly" | "biweekly" | "monthly";

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
  // 月1: 決めた日（その日が休みなら次の営業日）、空なら最初の営業日
  const target = item.monthDay ? run.find((r) => r.d >= item.monthDay!) : run[0];
  return target?.date === day.date;
}

export const KIND_LABEL: Record<SheetKind, string> = { temp: "温度の記録", clean: "点検・清掃", check: "毎日のチェック", log: "記録の表", label: "ラベル" };
export const FREQ_LABEL: Record<Freq, string> = { daily: "毎日", weekly: "1回/週", biweekly: "1回/2週", monthly: "1回/月" };

// ───────── 記録（入力） ─────────

export type Check = "" | "ok" | "ng";

export interface TempEntry {
  am?: number;
  pm?: number;
  humAm?: number;
  humPm?: number;
  /** 異常時の措置 */
  action?: string;
  who?: string;
}

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
      const bad = [t?.am, t?.pm].some((v) => outOfRange(def.temp, v));
      if (bad && !t?.action) out.push(`${d.d}日: 管理範囲の外です。異常時の措置を書いてください`);
      if (d.date < today && !t?.am && t?.am !== 0 && !t?.pm && t?.pm !== 0) out.push(`${d.d}日: 記入がありません`);
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

const it = (id: string, name: string, x: Partial<SheetItem> = {}): SheetItem => ({ id, name, ...x });
const MON_FRI = [1, 2, 3, 4, 5];
const MON_SAT = [1, 2, 3, 4, 5, 6];

export const DEFAULT_SHEETS: SheetDef[] = [
  {
    id: "temp-pizza-oven", title: "ピザ焼成温度記録（ジェットオーブン）", kind: "temp", area: "ピザ", weekdays: MON_FRI,
    rule: "設定温度 450℃（窯内測定 約443℃）／管理温度 440〜446℃。外れたら扉を開閉せず1時間後に再確認し、改善しなければ原材料の移動・廃棄等を検討し修理依頼する。",
    temp: { unit: "℃", set: 450, min: 440, max: 446, scale: [448, 447, 446, 445, 444, 443, 442, 441, 440, 439, 438], perDay: 2 },
  },
  {
    id: "temp-shock-freezer", title: "急速冷凍庫温度記録（ショックフリーザー）", kind: "temp", area: "ピザ", weekdays: MON_FRI,
    rule: "設定温度 −26℃／管理温度 −24〜−28℃。外れたら扉を開閉せず1時間後に再確認し、改善しなければ原材料の移動・廃棄等を検討し修理依頼する。",
    temp: { unit: "℃", set: -26, min: -28, max: -24, scale: [-22, -23, -24, -25, -26, -27, -28, -29, -30], perDay: 2 },
  },
  {
    id: "temp-storage", title: "原料保管庫 温度管理表（常温）", kind: "temp", area: "原料", weekdays: [0, 1, 2, 3, 4, 5],
    rule: "常温保管（直射日光・高温多湿を避ける）。目安：室温 28℃以下。異常があれば責任者へ報告のうえ措置を記録する。",
    temp: { unit: "℃", max: 28, humidity: true, perDay: 2 },
  },
  {
    id: "clean-pizza", title: "製造機械点検清掃計画（ピザ製造区域）", kind: "clean", area: "ピザ", weekdays: MON_FRI,
    rule: "○は計画。実施したら●。週1回の点検は毎週水曜。",
    items: [
      it("p1", "天井の点検", { note: "カビの生育、塗装の剥がれ、結露、照明", freq: "weekly", owner: "ピザ" }),
      it("p2", "天井の清掃", { note: "カビの生育があれば清掃する", freq: "weekly", owner: "ピザ" }),
      it("p3", "焼成機の清掃", { note: "内部及び外部清掃", freq: "daily", owner: "ピザ" }),
      it("p4", "生地寝かせ箱の清掃", { note: "残り生地、粉、生地カスの除去・清掃", freq: "daily", owner: "ピザ" }),
      it("p5", "生地寝かせ箱の点検", { note: "内部・外部破損がないか", freq: "weekly", owner: "ピザ" }),
      it("p6", "製造机の清掃", { note: "生地カス・粉溜まりの除去・清掃", freq: "daily", owner: "ピザ" }),
      it("p7", "ジェットオーブンの清掃", { note: "煤等除去、汚れ除去", freq: "daily", owner: "ピザ" }),
      it("p8", "床の清掃", { note: "掃き掃除", freq: "daily", owner: "ピザ" }),
      it("p9", "鼠トラップの点検", { freq: "weekly", owner: "ピザ" }),
      it("p10", "焼成機上部の点検", { note: "埃・換気扇回り清掃", freq: "weekly", owner: "ピザ" }),
    ],
  },
  {
    id: "clean-mixing", title: "製造機械点検清掃計画（仕込み区域）", kind: "clean", area: "パン", weekdays: MON_SAT,
    rule: "○は計画。実施したら●。",
    items: [
      it("m1", "ミキサー ボウル内部の清掃", { note: "特にボウル天井部の清掃し忘れに注意", freq: "daily", owner: "仕込", group: "ミキサー" }),
      it("m2", "ミキサーの上の清掃", { note: "粉溜まりの除去", freq: "biweekly", weekday: 5, owner: "仕込", group: "ミキサー" }),
      it("m3", "ミキサー下のハウジング内の清掃", { note: "生地カスの除去", freq: "biweekly", weekday: 5, owner: "仕込", group: "ミキサー" }),
      it("m4", "食洗器の清掃", { note: "庫内及び給排水口の点検清掃", freq: "daily", owner: "仕込" }),
      it("m5", "製氷機内部の点検", { note: "カビの生育がないか", freq: "weekly", weekday: 5, owner: "仕込" }),
      it("m6", "排水溝と排水ピットの清掃", { freq: "weekly", weekday: 5, owner: "仕込" }),
      it("m7", "鼠トラップの点検", { freq: "weekly", weekday: 5, owner: "仕込" }),
      it("m8", "頭上の点検", { note: "雨漏、塗装の剥がれ、結露、照明の破損", freq: "monthly", owner: "仕込" }),
    ],
  },
  {
    id: "check-tools", title: "備品管理表（ピザ焼成・真空）", kind: "check", area: "ピザ", weekdays: MON_FRI,
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
  {
    id: "log-metal", title: "金属検出機 動作確認記録（ピザ）", kind: "log", area: "ピザ",
    rule: "CCP（重要管理点）。検出感度 Fe φ5.0mm／SUS φ6.0mm。使用前・使用後にテストピースが検出・排出されたら ○、できなければ ×。×のときは前回確認以降に通した製品をすべて保留・再検査し、機械屋へ連絡して措置を書く。",
    columns: [
      { key: "date", label: "日付", type: "date", width: 10 }, { key: "product", label: "製品名／ロットNo", type: "text", width: 22 },
      { key: "beforeFe", label: "使用前 Fe", type: "okng", width: 8 }, { key: "beforeSus", label: "使用前 SUS", type: "okng", width: 8 },
      { key: "afterFe", label: "使用後 Fe", type: "okng", width: 8 }, { key: "afterSus", label: "使用後 SUS", type: "okng", width: 8 },
      { key: "who", label: "確認者", type: "text", width: 10 }, { key: "action", label: "異常時の措置・備考", type: "text", width: 26 },
    ],
  },
  {
    id: "log-daily", title: "製造日報", kind: "log", area: "パン",
    rule: "別紙の基準値を確認し、味・金検は ○×で記入。",
    columns: [
      { key: "date", label: "日付", type: "date", width: 10 }, { key: "product", label: "商品名", type: "text", width: 26 },
      { key: "weight", label: "重量", type: "number", width: 9 }, { key: "taste", label: "味", type: "okng", width: 7 },
      { key: "made", label: "製造数", type: "number", width: 10 }, { key: "metal", label: "金検", type: "okng", width: 7 },
      { key: "loss", label: "ロス", type: "number", width: 9 }, { key: "who", label: "記入者名", type: "text", width: 12 }, { key: "action", label: "備考", type: "text", width: 10 },
    ],
  },
  { id: "label-use-by", title: "材料使用日表（ラベル）", kind: "label", area: "全体", rule: "使用可能日を過ぎたものは破棄すること。切って容器に貼る。" },
];
