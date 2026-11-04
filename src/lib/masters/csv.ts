// マスタ CSV の共通エンジン（⑤）。どのマスタでも、列定義（MasterDef）を渡せば同じように使える。
//
//  - 取り込み: CSV（UTF-8 BOM あり・なし／Shift_JIS を自動で見分ける）を読んで、1行ずつ検証し、
//    「追加／更新（変わる項目の前→後）／変化なし／エラー」をプレビューとして返す。
//  - 確定は別の呼び出し（applyPreview）。エラーが1件でもあれば確定しない。確定するまで保存先には書かない。
//  - 書き出し: 同じ列定義で CSV にする（Excel でそのまま開ける UTF-8 BOM）。空のテンプレートも出せる。
//
// 保存先には触らない純粋な関数だけを置く（保存は store 側）。同じ入力なら必ず同じ結果になる。
import iconv from "iconv-lite";

export type ColType = "string" | "number" | "integer" | "boolean" | "enum" | "date" | "time" | "ref";

export interface ColumnDef {
  /** レコードの項目名。ドット区切りで入れ子も可（例 "deliveries.0.cutoff"） */
  key: string;
  /** CSV の列名（日本語） */
  label: string;
  /** 見出しの別名（取り込み時に受け付ける） */
  aliases?: string[];
  type: ColType;
  required?: boolean;
  /** enum のとき。CSV には label でも value でも書ける */
  options?: { value: string; label: string }[];
  /** ref のとき、参照するマスタの name。そのマスタの id か名前で書ける */
  ref?: string;
  min?: number;
  max?: number;
  /** 表示用の単位（kg・分 など） */
  unit?: string;
  /** テンプレート CSV の例の行に出す */
  example?: string;
  help?: string;
}

export interface MasterDef<T = Record<string, unknown>> {
  /** "suppliers" | "materials" | "packaging" | ... */
  name: string;
  /** 画面に出す名前（「仕入先」） */
  label: string;
  /** 一意の項目（"id"） */
  keyField: string;
  /** 新規で ID が空のときに振る ID の頭（"S" → S10, S11 …） */
  idPrefix?: string;
  /** 一覧で名前として出す項目（ref を名前で書いたときの照合にも使う） */
  nameField?: string;
  columns: ColumnDef[];
  /** そのマスタ固有の、1行の中でのチェック。日本語のエラー文を返す */
  validate?: (row: T) => string[];
}

/** ref 列を照合するための、ほかのマスタの id と名前 */
export type RefIndex = Record<string, { id: string; name?: string }[]>;

export interface CellError {
  column: string; // 列名（日本語）
  message: string;
}

export type RowResult<T> =
  | { line: number; kind: "add"; id: string; record: T }
  | { line: number; kind: "update"; id: string; record: T; changes: { column: string; before: string; after: string }[] }
  | { line: number; kind: "same"; id: string; record: T }
  | { line: number; kind: "error"; id?: string; errors: CellError[]; raw: Record<string, string> };

export interface Preview<T> {
  master: string;
  fileName: string;
  encoding: "utf-8" | "shift_jis";
  /** CSV にあって列定義にない列（無視した） */
  ignoredColumns: string[];
  /** 列定義にあって CSV にない列（既存の値のまま／新規は空） */
  missingColumns: string[];
  rows: RowResult<T>[];
  counts: { add: number; update: number; same: number; error: number };
  /** ファイル全体の問題（見出しが無い・必須の列が無い・ID の重複 など） */
  fileErrors: string[];
  /** 確定できるか（エラー0件・ファイルの問題なし・変更が1件以上） */
  canApply: boolean;
}

// ───────── 文字コードと CSV ─────────

/** UTF-8（BOM あり・なし）と Shift_JIS を見分けて文字列にする */
export function decodeCsv(buf: Uint8Array): { text: string; encoding: "utf-8" | "shift_jis" } {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(buf.subarray(3)), encoding: "utf-8" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buf), encoding: "utf-8" };
  } catch {
    return { text: iconv.decode(Buffer.from(buf), "Shift_JIS"), encoding: "shift_jis" };
  }
}

/** CSV を行×列にする（ダブルクォート・改行入りのセル対応）。空行は飛ばす */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const esc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

// ───────── 値の読み書き ─────────

export function getPath(obj: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}

export function setPath(obj: Record<string, unknown>, key: string, value: unknown) {
  const parts = key.split(".");
  // 空の値で、まだ無い入れ子（例: 2便）を作らない
  if (value === undefined && getPath(obj, parts.slice(0, -1).join(".")) == null && parts.length > 1) return;
  let o: Record<string, unknown> = obj;
  parts.forEach((k, i) => {
    if (i === parts.length - 1) {
      if (value === undefined) delete o[k];
      else o[k] = value;
      return;
    }
    const nextIsIndex = /^\d+$/.test(parts[i + 1]);
    if (o[k] == null || typeof o[k] !== "object") o[k] = nextIsIndex ? [] : {};
    o = o[k] as Record<string, unknown>;
  });
}

const norm = (s: string) => s.normalize("NFKC").replace(/[\s　]/g, "").toLowerCase();

/** 値を CSV に書く文字にする */
export function formatCell(col: ColumnDef, v: unknown, refs: RefIndex = {}): string {
  if (v == null || v === "") return "";
  switch (col.type) {
    case "boolean":
      return v ? "はい" : "いいえ";
    case "enum":
      return col.options?.find((o) => o.value === String(v))?.label ?? String(v);
    case "ref": {
      const hit = (refs[col.ref ?? ""] ?? []).find((r) => r.id === String(v));
      return hit?.id ?? String(v);
    }
    default:
      return String(v);
  }
}

/** CSV の文字を値にする。読めなければ error を返す */
export function parseCell(col: ColumnDef, raw: string, refs: RefIndex = {}): { value?: unknown; error?: string } {
  const s = raw.normalize("NFKC").trim();
  if (s === "") return col.required ? { error: "必須です" } : { value: undefined };
  switch (col.type) {
    case "string":
      return { value: raw.trim() };
    case "number":
    case "integer": {
      const n = Number(s.replace(/,/g, ""));
      if (!Number.isFinite(n)) return { error: `数字で書いてください（「${raw}」）` };
      if (col.type === "integer" && !Number.isInteger(n)) return { error: `整数で書いてください（「${raw}」）` };
      if (col.min != null && n < col.min) return { error: `${col.min} 以上にしてください（${n}）` };
      if (col.max != null && n > col.max) return { error: `${col.max} 以下にしてください（${n}）` };
      return { value: n };
    }
    case "boolean": {
      if (/^(はい|○|◯|true|1|yes|y|有|あり)$/i.test(s)) return { value: true };
      if (/^(いいえ|×|false|0|no|n|無|なし)$/i.test(s)) return { value: false };
      return { error: `「はい」か「いいえ」で書いてください（「${raw}」）` };
    }
    case "enum": {
      const o = col.options?.find((o) => norm(o.value) === norm(s) || norm(o.label) === norm(s));
      return o ? { value: o.value } : { error: `「${raw}」は選べません（${col.options?.map((o) => o.label).join("・")}）` };
    }
    case "date": {
      const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/) ?? s.match(/^(\d{4})(\d{2})(\d{2})$/);
      if (!m) return { error: `日付は 2026-11-05 か 2026/11/5 の形で書いてください（「${raw}」）` };
      const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
      const d = new Date(`${iso}T00:00:00Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return { error: `ない日付です（「${raw}」）` };
      return { value: iso };
    }
    case "time": {
      const m = s.match(/^(\d{1,2})[:：時](\d{2})分?$/) ?? s.match(/^(\d{1,2})時$/);
      if (!m) return { error: `時刻は 15:00 の形で書いてください（「${raw}」）` };
      const h = Number(m[1]);
      const mi = Number(m[2] ?? 0);
      if (h > 23 || mi > 59) return { error: `ない時刻です（「${raw}」）` };
      return { value: `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}` };
    }
    case "ref": {
      const list = refs[col.ref ?? ""] ?? [];
      const hit = list.find((r) => norm(r.id) === norm(s)) ?? list.find((r) => r.name && norm(r.name) === norm(s));
      return hit ? { value: hit.id } : { error: `「${raw}」は${col.ref ? "登録されていません" : "参照先がありません"}（ID か名前で書いてください）` };
    }
  }
}

// ───────── 取り込み（プレビュー） ─────────

function nextId(prefix: string, used: Set<string>) {
  let max = 0;
  for (const id of used) {
    const m = id.match(new RegExp(`^${prefix}(\\d+)$`));
    if (m) max = Math.max(max, Number(m[1]));
  }
  let n = max + 1;
  while (used.has(`${prefix}${String(n).padStart(2, "0")}`)) n++;
  return `${prefix}${String(n).padStart(2, "0")}`;
}

/**
 * CSV を読んで、今の登録内容（existing）と比べたプレビューを作る。保存先には書かない。
 * - ID の列が空の行は新規（idPrefix で ID を振る）
 * - CSV に無い列は、更新なら今の値のまま、新規なら空
 * - CSV に無い既存の行は消さない（削除は画面で1件ずつ）
 */
export function previewCsv<T extends Record<string, unknown>>(
  def: MasterDef<T>,
  buf: Uint8Array,
  existing: T[],
  opts: { fileName?: string; refs?: RefIndex } = {},
): Preview<T> {
  const { text, encoding } = decodeCsv(buf);
  const grid = parseCsvText(text);
  const fileErrors: string[] = [];
  const empty = (): Preview<T> => ({
    master: def.name, fileName: opts.fileName ?? "", encoding, ignoredColumns: [], missingColumns: def.columns.map((c) => c.label),
    rows: [], counts: { add: 0, update: 0, same: 0, error: 0 }, fileErrors, canApply: false,
  });
  if (!grid.length) {
    fileErrors.push("CSV が空です");
    return empty();
  }
  const [head, ...body] = grid;
  const colIndex = new Map<ColumnDef, number>();
  const used = new Set<number>();
  for (const c of def.columns) {
    const names = [c.label, ...(c.aliases ?? []), c.key].map(norm);
    const i = head.findIndex((h, hi) => !used.has(hi) && names.includes(norm(h.replace(/[*＊]$/, "").replace(/（必須）|\(必須\)/, ""))));
    if (i >= 0) {
      colIndex.set(c, i);
      used.add(i);
    }
  }
  const ignoredColumns = head.filter((h, i) => !used.has(i) && h.trim() !== "");
  const missingColumns = def.columns.filter((c) => !colIndex.has(c)).map((c) => c.label);
  const keyCol = def.columns.find((c) => c.key === def.keyField);
  if (!colIndex.size) fileErrors.push(`見出しの行に、${def.label}の列名が1つもありません（1行目は ${def.columns.slice(0, 3).map((c) => c.label).join("・")} … のような列名にしてください）`);

  const byId = new Map(existing.map((r) => [String(getPath(r, def.keyField) ?? ""), r]));
  const usedIds = new Set(byId.keys());
  const seen = new Map<string, number>();
  const rows: RowResult<T>[] = [];

  body.forEach((cells, bi) => {
    const line = bi + 2; // 見出しが1行目
    const raw: Record<string, string> = {};
    for (const [c, i] of colIndex) raw[c.label] = cells[i] ?? "";
    const errors: CellError[] = [];
    if (cells.some((c) => /^例[:：]/.test(c.trim()))) {
      rows.push({ line, kind: "error", errors: [{ column: "", message: "テンプレートの「例:」の行です。消してから読み込んでください" }], raw });
      return;
    }
    let id = keyCol && colIndex.has(keyCol) ? (cells[colIndex.get(keyCol)!] ?? "").normalize("NFKC").trim() : "";
    const base = id && byId.has(id) ? byId.get(id)! : undefined;
    const record = (base ? structuredClone(base) : {}) as Record<string, unknown>;

    for (const c of def.columns) {
      if (c.key === def.keyField) continue;
      if (!colIndex.has(c)) {
        if (!base && c.required) errors.push({ column: c.label, message: "必須の列が CSV にありません" });
        continue;
      }
      const r = parseCell(c, raw[c.label], opts.refs);
      if (r.error) errors.push({ column: c.label, message: r.error });
      else setPath(record, c.key, r.value);
    }
    if (!id) {
      if (!def.idPrefix) errors.push({ column: keyCol?.label ?? def.keyField, message: "必須です" });
      else {
        id = nextId(def.idPrefix, usedIds);
        usedIds.add(id);
      }
    }
    if (id) {
      if (seen.has(id)) errors.push({ column: keyCol?.label ?? def.keyField, message: `${seen.get(id)}行目と同じ ID です` });
      else seen.set(id, line);
      setPath(record, def.keyField, id);
    }
    if (!errors.length && def.validate) for (const m of def.validate(record as T)) errors.push({ column: "", message: m });

    if (errors.length) {
      rows.push({ line, kind: "error", id: id || undefined, errors, raw });
      return;
    }
    if (!base) {
      rows.push({ line, kind: "add", id, record: record as T });
      return;
    }
    const changes = def.columns
      .filter((c) => colIndex.has(c))
      .map((c) => ({ column: c.label, before: formatCell(c, getPath(base, c.key), opts.refs), after: formatCell(c, getPath(record, c.key), opts.refs) }))
      .filter((x) => x.before !== x.after);
    rows.push(changes.length ? { line, kind: "update", id, record: record as T, changes } : { line, kind: "same", id, record: record as T });
  });

  const counts = { add: 0, update: 0, same: 0, error: 0 };
  for (const r of rows) counts[r.kind]++;
  if (!body.length) fileErrors.push("見出しの下に、データの行がありません");
  return {
    master: def.name, fileName: opts.fileName ?? "", encoding, ignoredColumns, missingColumns, rows, counts, fileErrors,
    canApply: !fileErrors.length && counts.error === 0 && counts.add + counts.update > 0,
  };
}

/** プレビューから、保存する行（追加＋更新）を取り出す。エラーがあれば投げる（確定させない） */
export function recordsToApply<T>(p: Preview<T>): T[] {
  if (p.fileErrors.length || p.counts.error) throw new Error(`エラーが ${p.counts.error + p.fileErrors.length} 件あるので確定できません。CSV を直してもう一度読み込んでください`);
  return p.rows.flatMap((r) => (r.kind === "add" || r.kind === "update" ? [r.record] : []));
}

// ───────── 書き出し ─────────

/** 列定義どおりの CSV（Excel で開ける UTF-8 BOM、改行 CRLF）。encoding="shift_jis" も選べる */
export function exportCsv<T>(def: MasterDef<T>, rows: T[], opts: { refs?: RefIndex; encoding?: "utf-8" | "shift_jis" } = {}): Buffer {
  const lines = [
    def.columns.map((c) => esc(c.label)).join(","),
    ...rows.map((r) => def.columns.map((c) => esc(formatCell(c, getPath(r, c.key), opts.refs))).join(",")),
  ];
  const text = lines.join("\r\n") + "\r\n";
  return opts.encoding === "shift_jis" ? iconv.encode(text, "Shift_JIS") : Buffer.from("﻿" + text, "utf8");
}

/** 空のテンプレート（見出し＋例の行）。例の行は「例:」で始めるので、そのまま取り込むとエラーになって気づける */
export function templateCsv(def: MasterDef): Buffer {
  const head = def.columns.map((c) => esc(c.label + (c.required ? "（必須）" : ""))).join(",");
  const ex = def.columns
    .map((c, i) => esc((i === 0 ? "例:" : "") + (c.example ?? (c.type === "enum" ? (c.options?.[0]?.label ?? "") : ""))))
    .join(",");
  return Buffer.from("﻿" + head + "\r\n" + ex + "\r\n", "utf8");
}

/** 個別の編集（画面のフォーム）も、CSV と同じ決まりで検証する。値は文字のまま受け取る */
export function validateForm<T extends Record<string, unknown>>(
  def: MasterDef<T>,
  input: Record<string, string>,
  base: T | undefined,
  refs: RefIndex = {},
): { record?: T; errors: CellError[] } {
  const record = (base ? structuredClone(base) : {}) as Record<string, unknown>;
  const errors: CellError[] = [];
  for (const c of def.columns) {
    if (c.key === def.keyField && base) continue;
    if (!(c.key in input)) continue;
    const r = parseCell(c, input[c.key] ?? "", refs);
    if (r.error) errors.push({ column: c.label, message: r.error });
    else setPath(record, c.key, r.value);
  }
  if (!errors.length && def.validate) for (const m of def.validate(record as T)) errors.push({ column: "", message: m });
  return errors.length ? { errors } : { record: record as T, errors };
}
