// 記録の漏れ・時間のアラーム（⑧ A）。純関数（保存も通知もしない）。
// 担当者「視察で『ここが漏れていますね』と言われたことがある。記録の時間（9時・15時など）になったらアラーム。
//          提出期限を決めて、出ていなければ製造にアラーム。金属検査は商品を流すたびに」
//   - 衛生のシートごとに 記録する時刻（例 9:00・15:00）・締め（何分過ぎたら漏れ）・提出期限（翌月の何日までに責任者の確認）を決める
//   - 時刻が来たら「記録の時間です」（due）、締めを過ぎたら「漏れ」（late）。過ぎた日の書いていない所も漏れ
//   - 製品カードの金属検査は、ミキサーの回数（＝流す回数）ぶん ○× が要る
import { isPlanned, runDays, type SheetDef, type SheetRecord } from "../hygiene/sheets";

export interface SheetAlarm {
  on: boolean;
  /** 記録する時刻（温度は 1つ目＝①午前・2つ目＝②午後。点検・チェックは「この時刻までに」） */
  times: string[];
  /** 締め: 時刻から何分過ぎたら漏れ */
  graceMin: number;
  /** 提出期限: 翌月の何日までに責任者の確認（0 なら見ない） */
  submitDay: number;
}

export interface CardAlarm {
  on: boolean;
  /** この時刻までに、製造日の製品カード（金属検査の ○×）を書く */
  doneBy: string;
  graceMin: number;
}

export interface AlarmSettings {
  sheets: Record<string, Partial<SheetAlarm>>;
  cards: CardAlarm;
}

export const DEFAULT_CARD_ALARM: CardAlarm = { on: true, doneBy: "17:00", graceMin: 60 };
export const DEFAULT_ALARM_SETTINGS: AlarmSettings = { sheets: {}, cards: DEFAULT_CARD_ALARM };

/** そのシートの決まり（決めていない所は、シートの種類から） */
export function alarmOf(def: SheetDef, s: AlarmSettings): SheetAlarm {
  const base: SheetAlarm =
    def.kind === "temp"
      ? { on: true, times: def.temp?.perDay === 2 ? ["09:00", "15:00"] : ["09:00"], graceMin: 60, submitDay: 5 }
      : def.kind === "clean" || def.kind === "check"
        ? { on: true, times: ["17:00"], graceMin: 60, submitDay: 5 }
        : { on: true, times: [], graceMin: 60, submitDay: 5 };
  const x = s.sheets[def.id] ?? {};
  return { ...base, ...x, times: (x.times ?? base.times).filter((t) => /^\d{2}:\d{2}$/.test(t)).sort() };
}

export type GapState = "due" | "late";
export interface Gap {
  key: string;
  kind: "temp" | "clean" | "approve" | "metal";
  /** シート（衛生）か、製品カードの生地 */
  sheetId?: string;
  cardKey?: string;
  title: string;
  date: string;
  time?: string;
  /** 人に見せる一文（例「9:00 の温度の記録がまだです」） */
  text: string;
  state: GapState;
  /** 締め（JST "YYYY-MM-DDTHH:MM"） */
  deadline: string;
  href: string;
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const has = (v: unknown) => v != null && v !== "";
const prevMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

/** 状態: まだ時刻前なら undefined、時刻〜締めは due、締めを過ぎたら late。過ぎた日は late */
function stateOf(date: string, time: string, graceMin: number, now: string): { state?: GapState; deadline: string } {
  const today = now.slice(0, 10);
  const end = toMin(time) + graceMin;
  const deadline = `${date}T${hm(Math.min(end, 23 * 60 + 59))}`;
  if (date < today) return { state: "late", deadline };
  if (date > today) return { deadline };
  const t = toMin(now.slice(11, 16));
  if (t >= end) return { state: "late", deadline };
  if (t >= toMin(time)) return { state: "due", deadline };
  return { deadline };
}

export interface SheetInput {
  def: SheetDef;
  /** その月の記録 */
  rec?: SheetRecord;
  /** 前の月の記録（提出期限を見る） */
  prev?: SheetRecord;
  holidays?: string[];
}

export interface CardInputForGaps {
  key: string;
  name: string;
  /** 製造日 */
  date: string;
  /** ミキサーの回数（＝流す回数） */
  runs: number;
  items: { productId: string; name: string; metal: (string | undefined)[] }[];
  href: string;
}

/**
 * 漏れの一覧。now は日本時間 "YYYY-MM-DDTHH:MM"。今月の1日から今日まで（過ぎた日も含む）と、前の月の提出期限。
 * onlyToday: 今日の分だけ（お知らせ用）
 */
export function recordGaps(now: string, sheets: SheetInput[], settings: AlarmSettings, cards: CardInputForGaps[] = [], opts: { onlyToday?: boolean } = {}): Gap[] {
  const today = now.slice(0, 10);
  const month = today.slice(0, 7);
  const out: Gap[] = [];
  for (const { def, rec, prev, holidays = [] } of sheets) {
    if (def.active === false) continue;
    const a = alarmOf(def, settings);
    if (!a.on) continue;
    const href = `/hygiene/${def.id}?month=${month}`;
    const days = runDays(def, month, holidays).filter((d) => d.date <= today && (!opts.onlyToday || d.date === today));
    if (def.kind === "temp") {
      const slots = a.times.slice(0, def.temp?.perDay ?? 1);
      for (const d of days) {
        const e = rec?.temps?.[d.date];
        slots.forEach((time, i) => {
          if (has(i === 0 ? e?.am : e?.pm)) return;
          const s = stateOf(d.date, time, a.graceMin, now);
          if (!s.state) return;
          out.push({ key: `temp:${def.id}:${d.date}:${time}`, kind: "temp", sheetId: def.id, title: def.title, date: d.date, time, text: `${time} の温度の記録がまだです`, state: s.state, deadline: s.deadline, href });
        });
      }
    }
    if ((def.kind === "clean" || def.kind === "check") && a.times[0]) {
      const run = runDays(def, month, holidays);
      for (const d of days) {
        const miss = (def.items ?? []).filter((it) => (def.kind === "check" || isPlanned(it, d, run)) && rec?.done?.[`${it.id}|${d.date}`] == null);
        if (!miss.length) continue;
        const s = stateOf(d.date, a.times[0], a.graceMin, now);
        if (!s.state) continue;
        out.push({
          key: `clean:${def.id}:${d.date}`, kind: "clean", sheetId: def.id, title: def.title, date: d.date, time: a.times[0],
          text: `${a.times[0]} までの「${miss.slice(0, 3).map((x) => x.name).join("・")}${miss.length > 3 ? ` ほか${miss.length - 3}` : ""}」がまだです`,
          state: s.state, deadline: s.deadline, href,
        });
      }
    }
    // 提出期限: 前の月の分を、今月の submitDay までに責任者が確認
    if (a.submitDay > 0 && !opts.onlyToday) {
      const pm = prevMonth(month);
      const due = `${month}-${String(a.submitDay).padStart(2, "0")}`;
      const touched = prev && (has(prev.temps && Object.keys(prev.temps).length) || has(prev.done && Object.keys(prev.done).length) || (prev.rows?.length ?? 0) > 0);
      if (touched && !prev?.approvedBy) {
        out.push({
          key: `approve:${def.id}:${pm}`, kind: "approve", sheetId: def.id, title: def.title, date: due,
          text: `${Number(pm.slice(5))}月分の責任者の確認がまだです（提出期限 ${Number(due.slice(8))}日）`,
          state: today > due ? "late" : "due", deadline: `${due}T23:59`, href: `/hygiene/${def.id}?month=${pm}`,
        });
      }
    }
  }
  if (settings.cards.on) {
    for (const c of cards) {
      if (c.date > today || (opts.onlyToday && c.date !== today)) continue;
      const s = stateOf(c.date, settings.cards.doneBy, settings.cards.graceMin, now);
      if (!s.state) continue;
      const runs = Math.max(1, c.runs);
      for (const it of c.items) {
        const done = it.metal.slice(0, runs).filter((x) => x === "ok" || x === "ng").length;
        if (done >= runs) continue;
        out.push({
          key: `metal:${c.key}:${c.date}:${it.productId}`, kind: "metal", cardKey: c.key, title: `製品カード ${c.name}`, date: c.date, time: settings.cards.doneBy,
          text: `${it.name}の金属検査があと${runs - done}回分ありません（流す回数 ${runs}回）`, state: s.state, deadline: s.deadline, href: c.href,
        });
      }
    }
  }
  return out.sort((x, y) => (x.state === y.state ? x.deadline.localeCompare(y.deadline) : x.state === "late" ? -1 : 1));
}

/** お知らせ（アラーム）にする形: 今日の分は1件ずつ、過ぎた日の漏れはシートごとに1件にまとめる */
export function gapAlerts(gaps: Gap[], today: string): { dedupeKey: string; level: "warn" | "danger"; title: string; detail: string; href: string; dueAt?: string }[] {
  const now = gaps.filter((g) => g.date === today || g.kind === "approve");
  const past = gaps.filter((g) => g.date < today && g.kind !== "approve");
  const bySheet = new Map<string, Gap[]>();
  for (const g of past) bySheet.set(g.sheetId ?? g.cardKey ?? g.title, [...(bySheet.get(g.sheetId ?? g.cardKey ?? g.title) ?? []), g]);
  return [
    ...now.map((g) => ({ dedupeKey: `record:${g.key}`, level: g.state === "late" ? ("danger" as const) : ("warn" as const), title: `${g.title}: ${g.text}`, detail: g.state === "late" ? "締めを過ぎました。記録して、責任者に知らせてください" : "記録の時間です", href: g.href, dueAt: `${g.deadline}:00+09:00` })),
    ...[...bySheet.values()].map((gs) => ({
      dedupeKey: `record-past:${gs[0].sheetId ?? gs[0].cardKey}:${today.slice(0, 7)}`, level: "danger" as const,
      title: `${gs[0].title}: 書いていない所が ${gs.length}件あります（${[...new Set(gs.map((g) => Number(g.date.slice(8))))].slice(0, 5).join("・")}日…）`,
      detail: "漏れの一覧から入力できます", href: "/hygiene/missing",
    })),
  ];
}
