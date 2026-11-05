// 工場の休業日（作者 11/5 夜 (10)）: 年末年始・お盆・臨時休業を、日付の範囲で登録する。
// - 範囲は kv の "factory_holiday_ranges"（いつから・いつまで・理由）
// - ⑦（衛生管理・自動印刷）が読む kv の "factory_holidays"（日付の一覧）にも、同じ中身を書く
// - 使う所: 夕方の製造計画の自動作成（休業日の分は作らない）・「いつもの注文がまだ」のお知らせ（出さない）・
//   代わりの日の提案（休業日は選ばない）・製造計画と発注書の画面（休業日なら知らせる）
import { kvGet, kvSet } from "@/lib/db/sqlite";

export interface HolidayRange { id: string; from: string; to: string; reason: string }

const RANGES = "factory_holiday_ranges";
const DATES = "factory_holidays";
const ymd = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

export const listHolidayRanges = (): HolidayRange[] => (kvGet<HolidayRange[]>(RANGES) ?? []).sort((a, b) => a.from.localeCompare(b.from));

/** 休業日の日付の一覧（YYYY-MM-DD） */
export const factoryHolidays = (): string[] => kvGet<string[]>(DATES) ?? [];
export const isFactoryHoliday = (date: string) => factoryHolidays().includes(date);
/** その日が休業日なら、その理由（無ければ undefined） */
export const holidayReason = (date: string) => listHolidayRanges().find((r) => r.from <= date && date <= r.to)?.reason;

export function expand(ranges: Pick<HolidayRange, "from" | "to">[]): string[] {
  const out = new Set<string>();
  for (const r of ranges) for (let d = r.from; d <= r.to; d = addDays(d, 1)) out.add(d);
  return [...out].sort();
}

/** まとめて保存する（画面の「保存」）。日付の形・順番・長すぎる範囲は止める */
export function saveHolidayRanges(list: Omit<HolidayRange, "id">[] & { id?: string }[], who: string): HolidayRange[] {
  if (!who.trim()) throw new Error("保存する人を選んでください");
  const clean = (list as (Omit<HolidayRange, "id"> & { id?: string })[])
    .map((r, i) => ({ id: r.id || `H${String(i + 1).padStart(2, "0")}`, from: r.from.trim(), to: (r.to || r.from).trim(), reason: (r.reason ?? "").trim() || "休業" }))
    .filter((r) => r.from);
  for (const r of clean) {
    if (!ymd.test(r.from) || !ymd.test(r.to)) throw new Error(`日付の形が違います：${r.from}〜${r.to}`);
    if (r.to < r.from) throw new Error(`「まで」が「から」より前です：${r.from}〜${r.to}`);
    if (expand([r]).length > 62) throw new Error(`1つの休みは2か月までにしてください：${r.from}〜${r.to}`);
  }
  kvSet(RANGES, clean);
  kvSet(DATES, expand(clean));
  kvSet(`${RANGES}_log`, [...(kvGet<{ at: string; who: string; count: number }[]>(`${RANGES}_log`) ?? []).slice(-49), { at: new Date().toISOString(), who, count: clean.length }]);
  return clean;
}
