// 取り込みの設定のマスタ（⑤）。画面（/masters/...）と CSV で変えられる。
//  - sheet_sources   … 読みに行く Google スプレッドシート（URL・シート名・範囲・得意先・納品先）
//  - sheet_columns   … シートの列見出し → 商品と入数（得意先ごとの様式）
//  - kirara_items   … 取引先の発注サイトの CSV の商品コード → 当社の商品・入数・振り分け先（コード変換表）
//  - infomart_headers… インフォマートの CSV の列名の言い方（実物の列名をここに足せば読める）
// 初期値は、今までコードに書いていた値（google_sheet/config.ts・kirara/config.ts・infomart/config.ts）。
import { findProduct } from "@/lib/catalog";
import { DEMO_SHEETS, SHEET_COLUMN_MAP } from "@/lib/channels/google_sheet/config";
import { INFOMART_HEADERS } from "@/lib/channels/infomart/config";
import { KIRARA_DESTS, KIRARA_ITEMS } from "@/lib/channels/kirara/config";
import type { MasterDef as BaseDef } from "./columns";

/** 取り込みの設定のマスタの名前は③の Masters に無いので、名前だけ文字にした定義 */
type MasterDef<T> = Omit<BaseDef<T>, "name"> & { name: string };

const productCheck = (id: unknown, label = "商品ID") => (id && !findProduct(String(id)) ? [`${label} ${String(id)} が商品マスタにありません`] : []);

// ───────── シート ─────────
export interface SheetSourceRecord extends Record<string, unknown> {
  id: string;
  label: string;
  url: string;
  sheetName: string;
  range?: string;
  customerId: string;
  place?: string;
  active?: boolean;
}
export const sheetSourceDef: MasterDef<SheetSourceRecord> = {
  name: "sheet_sources",
  label: "読みに行くシート",
  keyColumns: ["id"],
  columns: [
    { key: "id", label: "シートID", type: "text" },
    { key: "label", label: "呼び名", type: "text", required: true, example: "さかえ店 11月" },
    { key: "url", label: "シートのURL", type: "text", required: true, example: "https://docs.google.com/spreadsheets/d/…", help: "「リンクを知っている全員が閲覧可」にしたシートの URL" },
    { key: "sheetName", label: "シート名", type: "text", required: true, example: "2026年11月_さかえ店", help: "下のタブの名前" },
    { key: "range", label: "範囲", type: "text", example: "A1:H40", help: "空なら全部" },
    { key: "customerId", label: "得意先ID", type: "text", required: true, example: "C13" },
    { key: "place", label: "納品先", type: "text", example: "さかえ店" },
    { key: "active", label: "使う", type: "boolean", example: "はい" },
  ],
  check: (r) => (/^(https:\/\/docs\.google\.com\/spreadsheets\/d\/|demo:)/.test(r.url) ? [] : ["シートの URL は https://docs.google.com/spreadsheets/d/ で始まる形にしてください"]),
};

export interface SheetColumnRecord extends Record<string, unknown> {
  id: string;
  customerId: string;
  header: string;
  productId: string;
  piecesPerUnit: number;
  unit: string;
}
export const sheetColumnDef: MasterDef<SheetColumnRecord> = {
  name: "sheet_columns",
  label: "シートの列と商品",
  keyColumns: ["id"],
  columns: [
    { key: "id", label: "対応ID", type: "text" },
    { key: "customerId", label: "得意先ID", type: "text", required: true, example: "C13" },
    { key: "header", label: "シートの列見出し", type: "text", required: true, example: "バターロール（10個入）", help: "シートの1行目に書いてあるとおり" },
    { key: "productId", label: "商品ID", type: "text", required: true, example: "P01" },
    { key: "piecesPerUnit", label: "入数", type: "integer", required: true, min: 1, example: "10", help: "1ケースの個数" },
    { key: "unit", label: "単位", type: "text", required: true, example: "ケース" },
  ],
  check: (r) => productCheck(r.productId),
};

// ───────── 取引先の発注サイトの CSV ─────────
export interface KiraraItemRecord extends Record<string, unknown> {
  id: string; // 先方の商品コード
  name: string;
  productId?: string;
  piecesPerUnit: number;
  dest: string;
  shortName: string;
}
export const kiraraItemDef: MasterDef<KiraraItemRecord> = {
  name: "kirara_items",
  label: "専用サイトのコード表",
  keyColumns: ["id"],
  columns: [
    { key: "id", label: "先方の商品コード", type: "text", required: true, example: "910001" },
    { key: "name", label: "CSV の品名", type: "text", required: true, example: "バターロール（３５ｇ）／Ｐ", help: "CSV に出てくる品名と1字も違わないように（前日入れの判断に使う）" },
    { key: "productId", label: "当社の商品ID", type: "text", example: "P01", help: "空なら取り込み時に要確認" },
    { key: "piecesPerUnit", label: "1パックの個数", type: "integer", required: true, min: 1, example: "1" },
    { key: "dest", label: "振り分け先", type: "enum", required: true, options: KIRARA_DESTS.map((d) => ({ value: d.key, label: d.label })), example: "自社 包装" },
    { key: "shortName", label: "札の名前", type: "text", required: true, example: "バターロール①" },
  ],
  check: (r) => productCheck(r.productId, "当社の商品ID"),
};

// ───────── インフォマートの CSV ─────────
const INFOMART_FIELD_LABEL: Record<string, string> = {
  slipNo: "伝票番号", orderDate: "発注日", deliveryDate: "納品日", buyerCode: "発注元の企業コード", buyerName: "発注元の企業名",
  placeCode: "納品先コード", placeName: "納品先名", lineNo: "明細の行", itemCode: "商品コード", itemName: "商品名",
  spec: "規格", perUnit: "入数", qty: "数量", unit: "単位", note: "備考",
};
export interface InfomartHeaderRecord extends Record<string, unknown> {
  id: string; // 項目（slipNo など）
  label: string;
  aliases: string; // ・区切り
}
export const infomartHeaderDef: MasterDef<InfomartHeaderRecord> = {
  name: "infomart_headers",
  label: "インフォマートの列名",
  keyColumns: ["id"],
  columns: [
    { key: "id", label: "項目", type: "enum", required: true, options: Object.entries(INFOMART_FIELD_LABEL).map(([value, label]) => ({ value, label })) },
    { key: "label", label: "説明", type: "text" },
    { key: "aliases", label: "CSV の列名（・区切り）", type: "text", required: true, example: "伝票番号・伝票No", help: "実物の CSV の1行目の言い方を足す。左ほど優先" },
  ],
};

export const CHANNEL_DEFS = {
  sheet_sources: sheetSourceDef,
  sheet_columns: sheetColumnDef,
  kirara_items: kiraraItemDef,
  infomart_headers: infomartHeaderDef,
} as const;

export const CHANNEL_SEEDS = {
  sheet_sources: (): SheetSourceRecord[] =>
    Object.entries(DEMO_SHEETS).map(([k, s], i) => ({
      id: `SH0${i + 1}`, label: `${s.place ?? s.sheetName}（デモ ${k === "v1" ? "1回目" : "書き換え後"}）`, ...s, active: true,
    })),
  sheet_columns: (): SheetColumnRecord[] =>
    Object.entries(SHEET_COLUMN_MAP).flatMap(([customerId, m]) =>
      Object.entries(m).map(([header, v]) => ({ customerId, header, ...v })),
    ).map((r, i) => ({ id: `SC${String(i + 1).padStart(2, "0")}`, ...r })),
  kirara_items: (): KiraraItemRecord[] => KIRARA_ITEMS.map(({ code, ...x }) => ({ id: code, ...x, productId: x.productId || undefined })),
  infomart_headers: (): InfomartHeaderRecord[] =>
    Object.entries(INFOMART_HEADERS).map(([id, names]) => ({ id, label: INFOMART_FIELD_LABEL[id] ?? id, aliases: names.join("・") })),
};
