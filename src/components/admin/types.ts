// 管理画面（マスタ）の共通の形（②）。列の定義と検証の中身は③、CSV の読み書きは⑤、保存は①が作る。
// サーバーの画面から部品へ渡すので、ここには関数を入れない（文字・数・配列だけ）。

export type FieldType = "text" | "number" | "select" | "time" | "date" | "bool" | "textarea";

export interface ColumnDef {
  /** 行のデータのキー */
  key: string;
  /** 見出し（やさしい言葉で） */
  label: string;
  type?: FieldType;
  /** type が select のときの候補 */
  options?: { value: string; label: string }[];
  required?: boolean;
  /** 数の単位（kg・分・個 など） */
  unit?: string;
  /** 入力欄の下に出す説明 */
  help?: string;
  /** 一覧に出すか（初期値 true） */
  list?: boolean;
  /** 編集フォームに出すか（初期値 true） */
  form?: boolean;
  /** 変えられない（ID など） */
  readOnly?: boolean;
}

export type Row = Record<string, string | number | boolean | null | undefined>;

/** CSV 取り込みの結果（⑤のエンジンが返す形） */
export interface ImportResult {
  added: number;
  updated: number;
  /** エラーの行（1行目＝見出し） */
  errors: { line: number; message: string }[];
}

/** 保存・削除の結果 */
export type SaveResult = { ok: true; id?: string } | { ok: false; error: string; field?: string };
