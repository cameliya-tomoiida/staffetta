// 昔のコース表（Excel のルート表・マイマップ用の CSV）を読んで、取り込む前の一覧を作る（⑦）。純関数。
// - 見出しの行は最初の 10 行の中から探す（「名称」「名前」「得意先」「納品先」のある行）
// - コースの列が無ければ「担当」の列、それも無ければシートの名前（「○○コースルート表」→「○○」）
// - 同じ先が曜日ごとに何行もあるときは1つにまとめる（曜日はまとめる。順番は最初に出た行）
// - 「納品時間」が "05:00〜06:30" なら時間の希望、"05:00" だけなら納品時刻。「〜納品時間」の列は時間の希望（まで）
// - 既にある取引先と名前で突き合わせる（空白・株式会社・（デモ）などを外して比べる）
import type { CustomerMaster } from "@/data/types";

export interface Grid {
  sheet: string;
  rows: string[][];
}

export interface ImportRow {
  /** どのシートの何行目か（最初の行） */
  where: string;
  name: string;
  course: string;
  /** コースの中の順番（1から） */
  order: number;
  address?: string;
  postalCode?: string;
  deliveryTime?: string;
  deliveryWindowFrom?: string;
  deliveryWindowTo?: string;
  deliveryWeekdays?: number[];
  deliveryHowTo?: string;
  deliveryCaution?: string;
}

export type MatchKind = "same" | "similar" | "new";
export interface MatchedRow extends ImportRow {
  match: MatchKind;
  /** ひも付く取引先ID（same・similar のとき） */
  customerId?: string;
  customerName?: string;
}

const COLS: Record<string, RegExp> = {
  name: /^(名称|名前|得意先名?|納品先|曜日\/得意先名|曜日\/卸し先名|卸し?先名|お客様名|取引先名?)$/,
  course: /^(コース|配送コース|便)$/,
  staff: /^(担当|担当者名?)$/,
  order: /^(順番|訪問順|順|No\.?|番号)$/i,
  address: /^住所$/,
  postal: /^(郵便番号|〒)$/,
  time: /^(納品時間|納品時刻|時間)$/,
  timeTo: /^[〜～~]\s*納品時間$/,
  weekdays: /^(曜日|納品日（曜日）|納品日\(曜日\)|納品曜日)$/,
  howTo: /^納品の仕方/,
  caution: /^(注意事項|時間指定・注意事項|備考|メモ)$/,
};

const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const headKey = (s: string) => clean(s).replace(/\s|\n/g, "").replace(/（指定あり）|\(指定あり\)/, "");

/** "5:00" "05:00:00" "0.2083"（Excel の時刻）→ "05:00"。読めなければ undefined */
export function toHHMM(v: string): string | undefined {
  const s = clean(v).replace(/^[〜～~]/, "");
  if (!s) return undefined;
  const m = /^(\d{1,2})[:：時](\d{2})?/.exec(s);
  if (m) {
    const h = Number(m[1]);
    const mi = Number(m[2] ?? 0);
    if (h < 24 && mi < 60) return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  }
  const f = Number(s);
  if (Number.isFinite(f) && f > 0 && f < 1) {
    const total = Math.round(f * 1440);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }
  return undefined;
}

/** "火・木・土" "月;水" "毎日" → [2,4,6] */
export function toWeekdays(v: string): number[] | undefined {
  const s = clean(v);
  if (!s) return undefined;
  if (/毎日/.test(s)) return [0, 1, 2, 3, 4, 5, 6];
  const out = new Set<number>();
  for (const ch of s) {
    const i = "日月火水木金土".indexOf(ch);
    if (i >= 0) out.add(i);
  }
  return out.size ? [...out].sort((a, b) => a - b) : undefined;
}

/** 名前を比べやすくする（全角・半角をそろえ、空白・会社の種類・（デモ）を外す） */
export function normName(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/株式会社|有限会社|合同会社|社会福祉法人|医療法人|\(株\)|\(有\)|㈱|㈲/g, "")
    .replace(/\(デモ\)/g, "")
    .toLowerCase();
}

/** シートの名前からコースの名前（「森コースルート表」→「森」） */
const courseFromSheet = (sheet: string) => clean(sheet).replace(/ルート表$/, "").replace(/コース$/, "").trim();

/** 表（CSV・Excel のシート）を読んで、取り込む行にする */
export function parseRouteGrids(grids: Grid[]): { rows: ImportRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const out: ImportRow[] = [];
  const seen = new Map<string, ImportRow>();
  const counter = new Map<string, number>();
  for (const g of grids) {
    const hi = g.rows.slice(0, 10).findIndex((r) => r.some((c) => COLS.name.test(headKey(c))));
    if (hi < 0) {
      warnings.push(`「${g.sheet}」: 見出しの行（名称・名前・得意先 など）が見つからないので読みませんでした`);
      continue;
    }
    const head = g.rows[hi].map(headKey);
    const col = (k: keyof typeof COLS) => head.findIndex((h) => COLS[k].test(h));
    const c = Object.fromEntries(Object.keys(COLS).map((k) => [k, col(k as keyof typeof COLS)])) as Record<keyof typeof COLS, number>;
    const sheetCourse = courseFromSheet(g.sheet);
    const rowsWithOrder = g.rows.slice(hi + 1).map((r, i) => ({ r, line: hi + 2 + i }));
    if (c.order >= 0) rowsWithOrder.sort((a, b) => (Number(a.r[c.order]) || 1e9) - (Number(b.r[c.order]) || 1e9));
    for (const { r, line } of rowsWithOrder) {
      const get = (i: number) => (i >= 0 ? clean(r[i]) : "");
      const name = get(c.name);
      if (!name) continue;
      const course = (get(c.course) || get(c.staff) || sheetCourse).replace(/コース$/, "") || "（コースなし）";
      const key = `${course}|${normName(name)}`;
      const wd = toWeekdays(get(c.weekdays));
      const prev = seen.get(key);
      if (prev) {
        if (wd) prev.deliveryWeekdays = [...new Set([...(prev.deliveryWeekdays ?? []), ...wd])].sort((a, b) => a - b);
        continue;
      }
      const timeRaw = get(c.time);
      const [t1, t2] = timeRaw.split(/[〜～~\-－]/);
      const row: ImportRow = { where: `${g.sheet} ${line}行`, name, course, order: (counter.get(course) ?? 0) + 1 };
      counter.set(course, row.order);
      const from = toHHMM(t1 ?? "");
      const to = toHHMM(t2 ?? "") ?? toHHMM(get(c.timeTo));
      if (to) {
        row.deliveryWindowFrom = from;
        row.deliveryWindowTo = to;
      } else if (from) row.deliveryTime = from;
      if (get(c.address)) row.address = get(c.address);
      if (/^\d{3}-?\d{4}$/.test(get(c.postal))) row.postalCode = get(c.postal);
      if (wd) row.deliveryWeekdays = wd;
      if (get(c.howTo)) row.deliveryHowTo = get(c.howTo);
      if (get(c.caution)) row.deliveryCaution = get(c.caution);
      seen.set(key, row);
      out.push(row);
    }
  }
  return { rows: out, warnings };
}

/** 既にある取引先と名前で突き合わせる。同じ名前 → same、片方がもう片方を含む（3文字以上）→ similar、ほか → new */
export function matchCustomers(rows: ImportRow[], customers: Pick<CustomerMaster, "id" | "name">[]): MatchedRow[] {
  const list = customers.map((c) => ({ c, n: normName(c.name) }));
  return rows.map((r) => {
    const n = normName(r.name);
    const same = list.find((x) => x.n === n);
    if (same) return { ...r, match: "same", customerId: same.c.id, customerName: same.c.name };
    const sim = n.length >= 3 ? list.find((x) => x.n.length >= 3 && (x.n.includes(n) || n.includes(x.n))) : undefined;
    if (sim) return { ...r, match: "similar", customerId: sim.c.id, customerName: sim.c.name };
    return { ...r, match: "new" };
  });
}
