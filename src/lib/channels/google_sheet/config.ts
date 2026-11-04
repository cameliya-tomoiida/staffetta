// Google スプレッドシートの取り込みの設定（初期値）。画面（取り込みの設定のマスタ）から変えられる。
// ここにあるのは、マスタが空のときに入れるサンプルの値。

export interface SheetSpec {
  /** シートのURL（https://docs.google.com/spreadsheets/d/<ID>/...）または demo:<ファイル名> */
  url: string;
  sheetName: string;
  /** A1 形式の範囲（例 A1:H40）。空なら全部 */
  range?: string;
  customerId: string;
  /** 納品先（店舗名） */
  place?: string;
}

/** 列見出し → 商品と入数（＝この得意先の様式）。見出しにない列は品名から推測して要確認にする */
export const SHEET_COLUMN_MAP: Record<string, Record<string, { productId: string; piecesPerUnit: number; unit: string }>> = {
  C13: {
    "バターロール（10個入）": { productId: "P01", piecesPerUnit: 10, unit: "ケース" },
    "ミニロール白（20個入）": { productId: "P05", piecesPerUnit: 20, unit: "ケース" },
    "食パン8枚切（1斤）": { productId: "P03", piecesPerUnit: 1, unit: "斤" },
    "ピザクラスト23cm（10枚入）": { productId: "P07", piecesPerUnit: 10, unit: "ケース" },
  },
};

/** デモ用の得意先シート設定 */
export const DEMO_SHEETS = {
  v1: { url: "demo:ベーグル工房みなみ_2026年11月_さかえ店_v1.csv", sheetName: "2026年11月_さかえ店", customerId: "C13", place: "さかえ店" },
  v2: { url: "demo:ベーグル工房みなみ_2026年11月_さかえ店_v2.csv", sheetName: "2026年11月_さかえ店", customerId: "C13", place: "さかえ店" },
} satisfies Record<string, SheetSpec>;
