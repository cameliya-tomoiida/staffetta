// マスタの CSV 列定義と検証の「しくみ」（③）。各マスタの列は defs.ts。
// ⑤の CSV エンジン（ファイルの読み書き・画面・取り込みの確定）は、ここの関数で
//   1) 見出し行の列名（日本語）→ 項目の対応をとり（mapHeader）
//   2) 1行ずつ値を型に直して（parseRow）
//   3) 参照の存在・重複・種類ごとの必須を確かめる（validateItems）
// 書き出しは itemsToTable。どれも純関数で、保存はしない。
import type { Masters } from "@/data/types";

export type MasterName = keyof Masters;

export type ColumnType =
  | "text"
  | "number" // 小数あり
  | "integer"
  | "boolean" // はい／いいえ・○／×・1／0・true／false
  | "time" // "HH:MM"
  | "enum" // options のどれか（日本語の表示名でも、値でもよい）
  | "list" // "6;8"（; ・ 、 | で区切る）→ 数の配列
  | "map" // "6:144;8:200" → { 6: 144, 8: 200 }
  | "textlist" // "C02;C05" → ["C02","C05"]
  | "weekdays"; // "月;火;水" または "1;2;3" → [1,2,3]（0=日〜6=土）

export interface ColumnOption {
  value: string;
  label: string;
}

export interface ColumnDef {
  /** 内部の項目名（型のプロパティ名） */
  key: string;
  /** CSV の列名（日本語） */
  label: string;
  type: ColumnType;
  /** 必須 */
  required?: boolean;
  /** 行の内容によって必須（例: 自社製造なら生地が必須）。戻り値は必須の理由 */
  requiredWhen?: (row: Record<string, unknown>) => string | false;
  options?: readonly ColumnOption[];
  /** 参照先のマスタ（その ID が存在するか確かめる） */
  ref?: MasterName;
  min?: number;
  max?: number;
  /** 空のときに入れる値 */
  default?: unknown;
  /** 画面・CSV のひな形に出す説明と例 */
  help?: string;
  example?: string;
}

export interface MasterDef<T = Record<string, unknown>> {
  name: MasterName;
  /** 画面・ファイル名に使う名前 */
  label: string;
  /** 1件を決める列（重複チェック・上書きの単位）。例: ["id"]、配合なら ["doughId","materialId"] */
  keyColumns: string[];
  columns: ColumnDef[];
  /** 行をまたぐ・種類ごとの追加の検査（エラー文を返す） */
  check?: (item: T, all: Partial<Masters>) => string[];
}

export interface CellError {
  /** CSV の何行目か（見出し = 1、データの1行目 = 2） */
  row: number;
  /** 列名（日本語）。行全体のエラーなら "" */
  column: string;
  value: string;
  message: string;
}

export interface ParseResult<T> {
  items: T[];
  errors: CellError[];
  /** 見出しにあったが、使わない列 */
  unknownColumns: string[];
}

const TRUE = ["はい", "○", "◯", "1", "true", "yes", "y", "有", "あり", "する"];
const FALSE = ["いいえ", "×", "0", "false", "no", "n", "無", "なし", "しない"];

const norm = (s: string) => s.normalize("NFKC").trim();

/** 1つのセルを型に直す。空なら value は undefined */
export function parseCell(col: ColumnDef, raw: string | undefined): { value?: unknown; error?: string } {
  // 文字の列はそのまま（全角のかっこ・℃ などを変えない）。数・時刻・選択肢などは全角を半角にそろえて読む
  if (col.type === "text") {
    const t = (raw ?? "").trim();
    return t === "" ? { value: col.default } : { value: t };
  }
  const s = norm(raw ?? "");
  if (s === "") return { value: col.default };
  switch (col.type) {
    case "number":
    case "integer": {
      const n = Number(s.replace(/[,，円]/g, ""));
      if (!Number.isFinite(n)) return { error: "数字を入れてください" };
      if (col.type === "integer" && !Number.isInteger(n)) return { error: "整数を入れてください" };
      if (col.min !== undefined && n < col.min) return { error: `${col.min} 以上にしてください` };
      if (col.max !== undefined && n > col.max) return { error: `${col.max} 以下にしてください` };
      return { value: n };
    }
    case "boolean": {
      const l = s.toLowerCase();
      if (TRUE.includes(l)) return { value: true };
      if (FALSE.includes(l)) return { value: false };
      return { error: "「はい」か「いいえ」を入れてください" };
    }
    case "time": {
      const m = s.match(/^(\d{1,2}):(\d{2})$/);
      if (m && m[1] === "24" && m[2] === "00") return { value: "24:00" }; // 「その日の終わりまで」
      if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { error: "時刻は 08:30 の形で入れてください（その日の終わりまでなら 24:00）" };
      return { value: `${m[1].padStart(2, "0")}:${m[2]}` };
    }
    case "enum": {
      const o = col.options?.find((x) => x.value === s || norm(x.label) === s);
      if (!o) return { error: `次のどれかを入れてください: ${col.options?.map((x) => x.label).join("・")}` };
      return { value: o.value };
    }
    case "list": {
      const parts = s.split(/[;；・、|]/).map((x) => x.trim()).filter(Boolean);
      const nums = parts.map(Number);
      if (nums.some((n) => !Number.isFinite(n) || n <= 0)) return { error: "6;8 のように数を ; で区切って入れてください" };
      return { value: nums };
    }
    case "weekdays": {
      const names = ["日", "月", "火", "水", "木", "金", "土"];
      const out: number[] = [];
      for (const p of s.split(/[;；・、|,，\s]/).map((x) => x.trim()).filter(Boolean)) {
        const i = names.indexOf(p.replace(/曜日?$/, ""));
        const n = i >= 0 ? i : /^[0-6]$/.test(p) ? Number(p) : -1;
        if (n < 0) return { error: "曜日は「月;水;金」のように入れてください" };
        if (!out.includes(n)) out.push(n);
      }
      return { value: out.sort((a, b) => a - b) };
    }
    case "textlist":
      return { value: s.split(/[;；・、|]/).map((x) => x.trim()).filter(Boolean) };
    case "map": {
      const out: Record<number, number> = {};
      for (const p of s.split(/[;；、|]/).map((x) => x.trim()).filter(Boolean)) {
        const m = p.match(/^(\d+(?:\.\d+)?)\s*[:：=]\s*(\d+(?:\.\d+)?)$/);
        if (!m) return { error: "6:144;8:200 のように「入数:値段」を ; で区切って入れてください" };
        out[Number(m[1])] = Number(m[2]);
      }
      return { value: out };
    }
  }
}

/** 値を CSV のセルの文字にする（書き出し用） */
export function formatCell(col: ColumnDef, v: unknown): string {
  if (v === undefined || v === null) return "";
  switch (col.type) {
    case "boolean":
      return v ? "はい" : "いいえ";
    case "enum":
      return col.options?.find((o) => o.value === v)?.label ?? String(v);
    case "list":
    case "textlist":
      return (v as (number | string)[]).join(";");
    case "weekdays":
      return (v as number[]).map((n) => "日月火水木金土"[n]).join(";");
    case "map":
      return Object.entries(v as Record<string, number>).map(([k, x]) => `${k}:${x}`).join(";");
    default:
      return String(v);
  }
}

/** 見出し行 → 列定義。列名（日本語）でも項目名（英字）でもよい。順番は自由 */
export function mapHeader(def: MasterDef, header: string[]): { columns: (ColumnDef | undefined)[]; missing: ColumnDef[]; unknown: string[] } {
  const columns = header.map((h) => {
    const n = norm(h).replace(/[*＊]$/, "");
    return def.columns.find((c) => norm(c.label) === n || c.key === n);
  });
  const missing = def.columns.filter((c) => c.required && !columns.includes(c));
  const unknown = header.filter((h, i) => !columns[i] && norm(h) !== "");
  return { columns, missing, unknown };
}

/**
 * CSV の表（1行目 = 見出し）を、型の付いた行にする。
 * 型・必須・選択肢のエラーは行と列ごとに返す（エラーの行は items に入れない）。
 * 参照・重複の確認は validateItems で行う。
 */
export function parseTable<T>(def: MasterDef<T>, table: string[][]): ParseResult<T> {
  const [header, ...rows] = table;
  const errors: CellError[] = [];
  if (!header) return { items: [], errors: [{ row: 1, column: "", value: "", message: "見出しの行がありません" }], unknownColumns: [] };
  const { columns, missing, unknown } = mapHeader(def as MasterDef, header);
  for (const c of missing) errors.push({ row: 1, column: c.label, value: "", message: `「${c.label}」の列がありません` });
  if (missing.length) return { items: [], errors, unknownColumns: unknown };

  const items: T[] = [];
  rows.forEach((cells, i) => {
    const rowNo = i + 2;
    if (cells.every((c) => norm(c ?? "") === "")) return; // 空の行は飛ばす
    const row: Record<string, unknown> = {};
    const bad = new Set<string>();
    let ok = true;
    // 見出しに無い列は既定値
    for (const c of def.columns) if (c.default !== undefined) row[c.key] = c.default;
    columns.forEach((c, ci) => {
      if (!c) return;
      const { value, error } = parseCell(c, cells[ci]);
      if (error) {
        ok = false;
        bad.add(c.key);
        errors.push({ row: rowNo, column: c.label, value: cells[ci] ?? "", message: error });
      } else if (value !== undefined) row[c.key] = value;
    });
    for (const c of def.columns) {
      const empty = row[c.key] === undefined || row[c.key] === "";
      if (!empty || bad.has(c.key)) continue;
      const why = c.required ? "必須です" : c.requiredWhen?.(row);
      if (why) {
        ok = false;
        errors.push({ row: rowNo, column: c.label, value: "", message: why === "必須です" ? `「${c.label}」は必須です` : why });
      }
    }
    if (ok) items.push(row as T);
  });
  return { items, errors, unknownColumns: unknown };
}

export interface ItemError {
  /** items の何番目か（0始まり） */
  index: number;
  /** その行のキー（ID など）の表示 */
  key: string;
  column: string;
  message: string;
}

const keyOf = (def: MasterDef, item: Record<string, unknown>) => def.keyColumns.map((k) => String(item[k] ?? "")).join(" / ");

/**
 * 保存用の行 ID。キーが id だけのマスタはその id、
 * 配合・工程の配置など複数の列がキーのマスタは "DG01|M01" のようにつなぐ（①の保存の口は id で1件を決めるため）。
 */
export function rowId(def: MasterDef, item: Record<string, unknown>): string {
  return def.keyColumns.length === 1 ? String(item[def.keyColumns[0]] ?? "") : def.keyColumns.map((k) => String(item[k] ?? "")).join("|");
}

/**
 * 行の中身を確かめる: キーの重複、参照先の存在、種類ごとの検査（def.check）。
 * all には「取り込んだあとのマスタ一式」を渡す（同じ CSV で一緒に入る ID も参照できるように）。
 */
export function validateItems<T>(def: MasterDef<T>, items: T[], all: Partial<Masters>): ItemError[] {
  const errors: ItemError[] = [];
  const seen = new Map<string, number>();
  items.forEach((raw, index) => {
    const item = raw as Record<string, unknown>;
    const key = keyOf(def as MasterDef, item);
    if (seen.has(key)) errors.push({ index, key, column: def.keyColumns.join("・"), message: `同じものが ${seen.get(key)! + 1} 件目にもあります` });
    else seen.set(key, index);
    for (const c of def.columns) {
      if (!c.ref) continue;
      const v = item[c.key];
      if (v === undefined || v === "") continue;
      const target = (all[c.ref] ?? []) as { id?: string }[];
      if (!target.some((t) => t.id === v)) errors.push({ index, key, column: c.label, message: `「${v}」が${refLabel(c.ref)}にありません` });
    }
    for (const m of def.check?.(raw, all) ?? []) errors.push({ index, key, column: "", message: m });
  });
  return errors;
}

const REF_LABEL: Partial<Record<MasterName, string>> = {
  courses: "便のマスタ", products: "商品マスタ", doughs: "生地マスタ", materials: "材料マスタ", packaging: "包材マスタ", suppliers: "仕入先マスタ",
  equipment: "設備マスタ", toppings: "トッピングマスタ", shifts: "班マスタ", lines: "ラインマスタ", customers: "得意先マスタ",
};
const refLabel = (n: MasterName) => REF_LABEL[n] ?? n;

/** 書き出し: 見出し（日本語の列名）＋行 */
export function itemsToTable<T>(def: MasterDef<T>, items: T[]): string[][] {
  return [def.columns.map((c) => c.label), ...items.map((it) => def.columns.map((c) => formatCell(c, (it as Record<string, unknown>)[c.key])))];
}

/** 取り込み用のひな形（見出し＋例の1行） */
export function templateTable(def: MasterDef): string[][] {
  return [def.columns.map((c) => c.label), def.columns.map((c) => c.example ?? "")];
}
