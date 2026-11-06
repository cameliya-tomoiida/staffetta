// 弥生販売に取り込む CSV の様式（作者 11/6 担当者「弥生に取り込むデータの配列は今は分からないので、後から入れられるようにしてほしい」）。
// 列（何を・どの順・見出し）・見出しの行の有無・文字コード・日付の形・区切り・決まった値の列を、設定の画面で変えられる。
// 純関数（画面の見本とサーバーの CSV の両方で使う）。保存は yayoi-format-store.ts（kv yayoi_format）。
import type { DeliverySlip, SlipLine } from "./calc";

/** 列の中身に選べるもの（伝票・明細の決まった項目） */
export const YAYOI_FIELDS = {
  date: "伝票日付",
  slipNo: "伝票番号",
  customerCode: "得意先コード",
  customerName: "得意先名",
  lineNo: "行",
  productCode: "商品コード",
  productName: "商品名",
  quantity: "数量",
  unit: "単位",
  unitPrice: "単価",
  amount: "金額",
  taxRate: "税率",
  taxKind: "税区分",
  note: "備考",
  staffCode: "担当者コード",
} as const;
export type YayoiField = keyof typeof YAYOI_FIELDS;

export interface YayoiColumn {
  /** 見出しに出す名前 */
  label: string;
  /** 中身: 項目・決まった値（fixed）・空（blank） */
  source: YayoiField | "fixed" | "blank";
  /** source が fixed のときの値（例 掛売上） */
  value?: string;
}

export const DATE_FORMATS = {
  slash: "2026/11/06",
  hyphen: "2026-11-06",
  compact: "20261106",
  reiwa: "令和8年11月6日",
  reiwaShort: "R08/11/06",
} as const;
export type DateFormat = keyof typeof DATE_FORMATS;

export interface YayoiFormat {
  columns: YayoiColumn[];
  /** 1行目に見出しを入れる */
  header: boolean;
  encoding: "sjis" | "utf8";
  dateFormat: DateFormat;
  delimiter: "comma" | "tab";
  /** 担当者コード（決まった人の分を出すとき。空なら空） */
  staffCode?: string;
}

/** 初期の見本（これまでの形） */
export const DEFAULT_YAYOI_FORMAT: YayoiFormat = {
  columns: (["date", "slipNo", "customerCode", "customerName", "lineNo", "productCode", "productName", "quantity", "unit", "unitPrice", "amount", "taxRate", "note"] as YayoiField[]).map((f) => ({ label: YAYOI_FIELDS[f], source: f })),
  header: true,
  encoding: "sjis",
  dateFormat: "slash",
  delimiter: "comma",
};

const p2 = (n: number) => String(n).padStart(2, "0");

/** 日付（2026-11-06）を選んだ形に */
export function formatDate(iso: string, f: DateFormat): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  switch (f) {
    case "hyphen":
      return `${y}-${p2(m)}-${p2(d)}`;
    case "compact":
      return `${y}${p2(m)}${p2(d)}`;
    case "reiwa":
      return `令和${y - 2018 === 1 ? "元" : y - 2018}年${m}月${d}日`;
    case "reiwaShort":
      return `R${p2(y - 2018)}/${p2(m)}/${p2(d)}`;
    default:
      return `${y}/${p2(m)}/${p2(d)}`;
  }
}

/** 1つの値 */
export function fieldValue(f: YayoiField, s: DeliverySlip, l: SlipLine, i: number, fmt: YayoiFormat, customerCode: (id: string) => string): string | number {
  switch (f) {
    case "date": return formatDate(s.date, fmt.dateFormat);
    case "slipNo": return s.no;
    case "customerCode": return customerCode(s.customerId);
    case "customerName": return s.customerName;
    case "lineNo": return i + 1;
    case "productCode": return l.code ?? l.productId;
    case "productName": return l.name;
    case "quantity": return l.quantity;
    case "unit": return l.unit;
    case "unitPrice": return l.unitPrice;
    case "amount": return l.amount;
    case "taxRate": return `${l.taxRate}%${l.taxRate === 8 ? "（軽減）" : ""}`;
    case "taxKind": return l.taxRate === 8 ? "軽減税率8%" : "標準税率10%";
    case "note": return l.priceFrom === "売価" ? "単価は商品の売価" : "";
    case "staffCode": return fmt.staffCode ?? "";
  }
}

/** 伝票 → 行（1明細＝1行。同じ伝票番号の行が1枚の伝票） */
export function yayoiTable(slips: DeliverySlip[], fmt: YayoiFormat, customerCode: (id: string) => string = (id) => id): (string | number)[][] {
  return slips.flatMap((s) =>
    s.lines.map((l, i) => fmt.columns.map((c) => (c.source === "fixed" ? c.value ?? "" : c.source === "blank" ? "" : fieldValue(c.source, s, l, i, fmt, customerCode)))),
  );
}

/** CSV の文字列（UTF-8 のときだけ先頭に BOM。Shift_JIS への変換はサーバーで） */
export function yayoiCsv(slips: DeliverySlip[], fmt: YayoiFormat, customerCode?: (id: string) => string): string {
  const sep = fmt.delimiter === "tab" ? "\t" : ",";
  const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = yayoiTable(slips, fmt, customerCode);
  const lines = [...(fmt.header ? [fmt.columns.map((c) => c.label)] : []), ...rows].map((r) => r.map(q).join(sep));
  return (fmt.encoding === "utf8" ? "﻿" : "") + lines.map((l) => l + "\r\n").join("");
}

/** 見出しの名前から項目を当てる（弥生の書き方のゆれも拾う） */
const SYNONYMS: [RegExp, YayoiField][] = [
  [/^(伝票)?日付$|^売上日$|^取引日$/, "date"],
  [/伝票(番号|No|NO|№)/, "slipNo"],
  [/得意先.*(コード|CD|ｺｰﾄﾞ)/, "customerCode"],
  [/得意先(名|名称)?$/, "customerName"],
  [/^(行|行番号|明細(行|番号|No))$/, "lineNo"],
  [/商品.*(コード|CD|ｺｰﾄﾞ)/, "productCode"],
  [/^商品(名|名称)?$|^品名$/, "productName"],
  [/^数量$/, "quantity"],
  [/^単位$/, "unit"],
  [/単価/, "unitPrice"],
  [/^(金額|売上金額|税抜金額)$/, "amount"],
  [/^税率$/, "taxRate"],
  [/税区分|課税区分/, "taxKind"],
  [/^(備考|摘要|明細備考)$/, "note"],
  [/担当者?(コード|CD)/, "staffCode"],
];

export function guessField(label: string): YayoiField | undefined {
  const t = label.trim();
  return SYNONYMS.find(([re]) => re.test(t))?.[1];
}

/** 弥生から書き出した CSV の見出しの行を貼る → 列の並びを作る（分からない名前は空の列にして、あとで選ぶ） */
export function columnsFromHeader(line: string): YayoiColumn[] {
  const first = line.replace(/^﻿/, "").split(/\r?\n/).find((l) => l.trim()) ?? "";
  const sep = first.includes("\t") ? "\t" : ",";
  return first
    .split(sep)
    .map((x) => x.trim().replace(/^"(.*)"$/, "$1").replace(/""/g, '"').trim())
    .filter((x) => x)
    .map((label) => ({ label, source: guessField(label) ?? "blank" }));
}

/** 形を確かめて整える（保存の前） */
export function normalizeFormat(input: Partial<YayoiFormat>): YayoiFormat {
  const cols = (input.columns ?? []).map((c) => ({
    label: String(c.label ?? "").trim(),
    source: c.source === "fixed" || c.source === "blank" || (c.source && c.source in YAYOI_FIELDS) ? c.source : "blank",
    ...(c.source === "fixed" ? { value: String(c.value ?? "").trim() } : {}),
  })) as YayoiColumn[];
  if (!cols.length) throw new Error("列を1つ以上入れてください");
  if (cols.length > 80) throw new Error("列が多すぎます（80まで）");
  cols.forEach((c, i) => {
    if (!c.label) throw new Error(`${i + 1}列目の見出しを入れてください`);
  });
  return {
    columns: cols,
    header: input.header !== false,
    encoding: input.encoding === "utf8" ? "utf8" : "sjis",
    dateFormat: input.dateFormat && input.dateFormat in DATE_FORMATS ? input.dateFormat : "slash",
    delimiter: input.delimiter === "tab" ? "tab" : "comma",
    ...(input.staffCode?.trim() ? { staffCode: input.staffCode.trim() } : {}),
  };
}
