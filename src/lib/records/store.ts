import "server-only";
// 記録のアラーム（作者 11/6 (36) A）の保存と、お知らせの判定元。決まりは src/lib/records/alarms.ts（純関数）。
//   全体の決まり … kv の record_alarms（締めの分・提出期限の日・製品カードを見張るか）
//   シートの時刻 … 衛生のシートの決まり（hygiene_sheets）の timing
//   判定元      … scheduler の ALERT_SOURCES の "records"（機能の「記録のアラーム」で止められる）
import { kvGet, kvSet } from "@/lib/db/sqlite";
import { holidaysOf, listSheets, recordsOf, getSheet, saveSheet } from "@/lib/hygiene/store";
import type { AlertCandidate } from "@/lib/db/alerts-store";
import {
  DEFAULT_RECORD_ALARMS, cardSlots, jstDate, missingRows, monthHygieneSlots, normTime, slotAlerts, submitAlerts,
  type MissingRow, type RecordAlarmSettings, type RecordSlot,
} from "./alarms";

const KEY = "record_alarms";

export function getRecordAlarmSettings(): RecordAlarmSettings {
  return { ...DEFAULT_RECORD_ALARMS, ...(kvGet<Partial<RecordAlarmSettings>>(KEY) ?? {}) };
}

/** 全体の決まりと、シートごとの時刻を保存する */
export function saveRecordAlarms(s: RecordAlarmSettings, sheets: { id: string; times: string; off: boolean; graceMin?: number }[]) {
  const grace = Math.round(s.graceMin);
  const day = Math.round(s.submitDay);
  if (!(grace >= 5 && grace <= 240)) throw new Error("締めは 5〜240 分にしてください");
  if (!(day >= 1 && day <= 28)) throw new Error("提出期限は 1〜28 日にしてください");
  for (const x of sheets) {
    const def = getSheet(x.id);
    if (!def) throw new Error(`シートが見つかりません: ${x.id}`);
    const parts = x.times.split(/[,、\s]+/).map((t) => t.trim()).filter(Boolean);
    const bad = parts.filter((t) => !normTime(t));
    if (bad.length) throw new Error(`「${def.title}」の時刻の形が違います: ${bad.join("・")}（例 9:00, 15:00）`);
    const times = [...new Set(parts.map((t) => normTime(t)!))].sort();
    if (def.kind === "temp" && times.length > (def.temp?.perDay ?? 2)) throw new Error(`「${def.title}」は1日 ${def.temp?.perDay ?? 2}回の記録です。時刻は ${def.temp?.perDay ?? 2}つまでにしてください`);
    if (times.length > 3) throw new Error(`「${def.title}」の時刻は 3つまでにしてください`);
    const g = x.graceMin != null && Number.isFinite(x.graceMin) ? Math.round(x.graceMin) : undefined;
    saveSheet({ ...def, timing: { ...(times.length ? { times } : {}), ...(g ? { graceMin: g } : {}), ...(x.off ? { off: true } : {}) } });
  }
  kvSet(KEY, { graceMin: grace, submitDay: day, cards: !!s.cards });
}

const addDays = (date: string, n: number) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** 製品カードの記録の時刻（納品日 date の分） */
async function cardSlotsOf(date: string, s: RecordAlarmSettings): Promise<RecordSlot[]> {
  if (!s.cards) return [];
  const { loadCards } = await import("@/lib/cards/store");
  const { cards } = await loadCards(date, { weather: false });
  return cards.flatMap((c) => cardSlots(c.base, c.input, s));
}

/** 今日の記録の時刻（衛生のシート＋製品カード。夜の仕込みのため、あしたの納品分のカードも見る） */
export async function todaySlots(now: string): Promise<RecordSlot[]> {
  const s = getRecordAlarmSettings();
  const today = jstDate(now);
  const yesterday = addDays(today, -1);
  const months = [...new Set([today.slice(0, 7), yesterday.slice(0, 7)])];
  const hy = months.flatMap((m) => {
    const recs = recordsOf(m);
    return monthHygieneSlots(listSheets(), recs, m, holidaysOf(m), today, s).filter((x) => x.date >= yesterday);
  });
  const cards = (await Promise.all([today, addDays(today, 1)].map((d) => cardSlotsOf(d, s).catch(() => [])))).flat();
  return [...hy, ...cards];
}

/** お知らせの判定元（scheduler から） */
export async function recordAlertCandidates(now: string): Promise<AlertCandidate[]> {
  const s = getRecordAlarmSettings();
  const slots = await todaySlots(now);
  const today = jstDate(now);
  const prev = jstDate(new Date(Date.parse(`${today.slice(0, 7)}-01T12:00:00+09:00`) - 2 * 86400_000).toISOString()).slice(0, 7);
  const prevRecs = recordsOf(prev);
  const submit = submitAlerts(listSheets(), (id) => !!prevRecs.get(id)?.approvedBy, now, s);
  return [...slotAlerts(slots, now), ...submit].map((a) => ({ ...a, actions: [{ label: a.action, href: a.href, primary: true }] }));
}

export interface MissingReport {
  month: string;
  rows: MissingRow[];
  /** シートごとの数 */
  bySheet: { title: string; count: number; href: string }[];
  /** 責任者の確認がまだのシート */
  unapproved: { id: string; title: string }[];
}

/** その月の漏れの一覧（衛生のシート＋製品カード。今日の締めを過ぎた分まで） */
export async function missingReport(month: string, now: string, opts: { cards?: boolean } = {}): Promise<MissingReport> {
  const s = getRecordAlarmSettings();
  const today = jstDate(now);
  const recs = recordsOf(month);
  const sheets = listSheets();
  const slots: RecordSlot[] = monthHygieneSlots(sheets, recs, month, holidaysOf(month), today, s);
  if (opts.cards !== false && s.cards) {
    const { allOrders } = await import("@/demo/all-orders");
    const { orders } = await allOrders();
    const days = [...new Set(orders.filter((o) => o.deliveryDate.startsWith(month) && o.deliveryDate <= today && o.status !== "cancelled").map((o) => o.deliveryDate))].sort();
    for (const d of days) slots.push(...(await cardSlotsOf(d, s).catch(() => [])));
  }
  const rows = missingRows(slots, now);
  const by = new Map<string, { title: string; count: number; href: string }>();
  for (const r of rows) {
    const k = r.source === "card" ? "製品カード" : r.title;
    const cur = by.get(k) ?? { title: k, count: 0, href: r.source === "card" ? "/cards" : r.href };
    cur.count++;
    by.set(k, cur);
  }
  const unapproved = month < today.slice(0, 7) ? sheets.filter((d) => d.kind !== "label" && !recs.get(d.id)?.approvedBy).map((d) => ({ id: d.id, title: d.title })) : [];
  return { month, rows, bySheet: [...by.values()].sort((a, b) => b.count - a.count), unapproved };
}
