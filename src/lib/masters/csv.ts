// マスタ CSV の共通エンジン（⑤）。列定義と1セルずつの読み方・参照の検査は③の columns.ts / defs.ts を使い、
// ここではファイルの読み書き（UTF-8 BOM／Shift_JIS）と「プレビュー → 確定」の2段階を受け持つ。
//
//  - 取り込み: CSV を読んで、今の登録内容と比べ、行ごとに「追加／更新（変わる項目の前→後）／変化なし／エラー」を返す。
//    確定（recordsToApply → 保存）は別の呼び出し。エラーが1件でもあれば確定しない。確定まで保存先には書かない。
//  - CSV に無い列は、更新なら今の値のまま（③の既定値で上書きしない）。新規なら③の既定値。
//  - 書き出し: 同じ列定義で CSV にする（Excel でそのまま開ける UTF-8 BOM）。ひな形（見出し＋例の行）も出せる。
// 保存先には触らない純粋な関数だけ。同じ入力なら必ず同じ結果になる。
import iconv from "iconv-lite";
import type { Masters } from "@/data/types";
import { formatCell, itemsToTable, mapHeader, parseTable, rowId, templateTable, validateItems, type ColumnDef, type MasterDef } from "./columns";

export type { ColumnDef, MasterDef };

export interface RowError {
  column: string; // 列名（日本語）。行全体なら ""
  message: string;
}

type Rec = Record<string, unknown> & { id: string };

export type RowResult<T = Rec> =
  | { line: number; kind: "add"; id: string; record: T }
  | { line: number; kind: "update"; id: string; record: T; changes: { column: string; before: string; after: string }[] }
  | { line: number; kind: "same"; id: string; record: T }
  | { line: number; kind: "error"; id?: string; errors: RowError[]; raw: Record<string, string> };

export interface Preview<T = Rec> {
  master: string;
  fileName: string;
  encoding: "utf-8" | "shift_jis";
  /** CSV にあって列定義にない列（無視した） */
  ignoredColumns: string[];
  /** 列定義にあって CSV にない列（更新は今の値のまま／新規は既定値） */
  missingColumns: string[];
  rows: RowResult<T>[];
  counts: { add: number; update: number; same: number; error: number };
  /** ファイル全体の問題（見出しが無い・必須の列が無い など） */
  fileErrors: string[];
  /** 確定できるか（エラー0件・ファイルの問題なし・変更が1件以上） */
  canApply: boolean;
}

// ───────── 文字コードと CSV ─────────

/** UTF-8（BOM あり・なし）と Shift_JIS を見分けて文字列にする */
export function decodeCsv(buf: Uint8Array): { text: string; encoding: "utf-8" | "shift_jis" } {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { text: new TextDecoder("utf-8").decode(buf.subarray(3)), encoding: "utf-8" };
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
export const tableToCsv = (t: string[][]) => t.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";

// ───────── 取り込み（プレビュー） ─────────

/**
 * CSV を読んで、今の登録内容（existing: id 付きの行）と比べたプレビューを作る。保存先には書かない。
 * all: 今のマスタ一式（参照の確認に使う）。この CSV の行を入れた「取り込んだあと」の一式で確かめる。
 */
export function previewCsv<T>(defT: MasterDef<T>, buf: Uint8Array, existing: Rec[], all: Partial<Masters>, opts: { fileName?: string } = {}): Preview {
  const def = defT as unknown as MasterDef;
  const { text, encoding } = decodeCsv(buf);
  const grid = parseCsvText(text);
  const fileErrors: string[] = [];
  const result = (rows: RowResult[], ignored: string[], missing: string[]): Preview => {
    const counts = { add: 0, update: 0, same: 0, error: 0 };
    for (const r of rows) counts[r.kind]++;
    if (!fileErrors.length && !rows.length) fileErrors.push("見出しの下に、データの行がありません");
    return {
      master: def.name, fileName: opts.fileName ?? "", encoding, ignoredColumns: ignored, missingColumns: missing, rows, counts, fileErrors,
      canApply: !fileErrors.length && counts.error === 0 && counts.add + counts.update > 0,
    };
  };
  if (!grid.length) {
    fileErrors.push("CSV が空です");
    return result([], [], def.columns.map((c) => c.label));
  }
  // 見出しの「（必須）」は外して読む（ひな形から作った CSV でも読めるように）
  const header = grid[0].map((h) => h.replace(/（必須）|\(必須\)/, "").trim());
  const { columns: hcols, missing: missingRequired, unknown } = mapHeader(def, header);
  const present = def.columns.filter((c) => hcols.includes(c));
  const missingAll = def.columns.filter((c) => !present.includes(c)).map((c) => c.label);
  if (!present.length) {
    fileErrors.push(`見出しの行に、${def.label}の列名が1つもありません（1行目は ${def.columns.slice(0, 3).map((c) => c.label).join("・")} … のような列名にしてください）`);
    return result([], unknown, missingAll);
  }
  const byId = new Map(existing.map((r) => [r.id, r]));
  // 必須の列が見出しに無いときは、空の列として足して読む（更新なら今の値を使うのでエラーにしない）
  const fullHeader = [...header, ...missingRequired.map((c) => c.label)];

  const rows: RowResult[] = [];
  const records: { line: number; record: Rec; base?: Rec }[] = [];
  grid.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const raw: Record<string, string> = {};
    hcols.forEach((c, ci) => {
      if (c) raw[c.label] = cells[ci] ?? "";
    });
    if (cells.some((c) => /^例[:：]/.test(c.trim()))) {
      rows.push({ line, kind: "error", errors: [{ column: "", message: "ひな形の「例:」の行です。消してから読み込んでください" }], raw });
      return;
    }
    const keyGuess = pickKeys(def, cells, hcols);
    const id0 = def.keyColumns.every((k) => keyGuess[k]) ? rowId(def, keyGuess) : "";
    const base = id0 ? byId.get(id0) : undefined;
    // 1行ずつ③の parseTable で読む（行番号を合わせるため）
    const pr = base
      ? parseTable(optional(def), [header, cells])
      : parseTable(def, [fullHeader, [...cells, ...missingRequired.map(() => "")]]);
    if (pr.errors.length) {
      rows.push({ line, kind: "error", id: id0 || undefined, errors: pr.errors.map((e) => ({ column: e.column, message: e.message })), raw });
      return;
    }
    const parsed = (pr.items[0] ?? {}) as Record<string, unknown>;
    let record: Rec;
    if (base) {
      // 更新: CSV にある列だけ差し替える（無い列は今の値のまま）
      record = { ...base };
      for (const c of present) {
        const v = parsed[c.key];
        if (v === undefined || v === "") delete record[c.key];
        else record[c.key] = v;
      }
      // 更新でも、必須の列を空にしたらエラー
      const emptied = present.filter((c) => c.required && (record[c.key] === undefined || record[c.key] === ""));
      if (emptied.length) {
        rows.push({ line, kind: "error", id: base.id, errors: emptied.map((c) => ({ column: c.label, message: `「${c.label}」は必須です` })), raw });
        return;
      }
    } else {
      record = { ...parsed } as Rec;
    }
    record.id = rowId(def, record);
    records.push({ line, record, base });
  });

  // 参照・重複・種類ごとの検査は、取り込んだあとの一式で
  const after = new Map(existing.map((r) => [r.id, r]));
  for (const r of records) after.set(r.record.id, r.record);
  const afterList = [...after.values()];
  const itemErrors = validateItems(def, afterList, { ...all, [def.name]: afterList } as Partial<Masters>);
  const errByIndex = new Map<number, RowError[]>();
  for (const e of itemErrors) errByIndex.set(e.index, [...(errByIndex.get(e.index) ?? []), { column: e.column, message: e.message }]);
  const indexOf = new Map(afterList.map((r, i) => [r.id, i]));
  const seen = new Map<string, number>();

  for (const { line, record, base } of records) {
    const dupLine = seen.get(record.id);
    if (dupLine === undefined) seen.set(record.id, line);
    const errs = [
      ...(dupLine !== undefined ? [{ column: def.keyColumns.join("・"), message: `${dupLine}行目と同じものです` }] : []),
      ...(errByIndex.get(indexOf.get(record.id) ?? -1) ?? []),
    ];
    if (errs.length) {
      rows.push({ line, kind: "error", id: record.id, errors: errs, raw: Object.fromEntries(present.map((c) => [c.label, formatCell(c, record[c.key])])) });
      continue;
    }
    if (!base) {
      rows.push({ line, kind: "add", id: record.id, record });
      continue;
    }
    const changes = present
      .map((c) => ({ column: c.label, before: formatCell(c, base[c.key]), after: formatCell(c, record[c.key]) }))
      .filter((x) => x.before !== x.after);
    rows.push(changes.length ? { line, kind: "update", id: record.id, record, changes } : { line, kind: "same", id: record.id, record });
  }
  rows.sort((a, b) => a.line - b.line);
  return result(rows, unknown, missingAll);
}

/** 必須・条件つき必須を外した定義（更新で、CSV に無い列は今の値を使うため） */
const optional = (def: MasterDef): MasterDef => ({
  ...def,
  columns: def.columns.map((c) => ({ ...c, required: false, requiredWhen: undefined, default: undefined })),
});

/** 見出しにあるキーの列だけを、文字のまま取り出す（ID を先に決めるため） */
function pickKeys(def: MasterDef, cells: string[], hcols: (ColumnDef | undefined)[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  hcols.forEach((c, i) => {
    if (!c || !def.keyColumns.includes(c.key)) return;
    const v = (cells[i] ?? "").trim();
    // enum のキー（ラインなど）は表示名でも書けるので、値に直す
    // 文字の列（便ID など）は③の parseCell と同じく、そのまま（全角のかっこを変えない）
    const o = c.options?.find((x) => x.value === v.normalize("NFKC") || x.label === v);
    out[c.key] = o ? o.value : c.type === "text" ? v : v.normalize("NFKC");
  });
  return out;
}

/** プレビューから、保存する行（追加＋更新）を取り出す。エラーがあれば投げる（確定させない） */
export function recordsToApply(p: Preview): Rec[] {
  if (p.fileErrors.length || p.counts.error) throw new Error(`エラーが ${p.counts.error + p.fileErrors.length} 件あるので確定できません。CSV を直してもう一度読み込んでください`);
  return p.rows.flatMap((r) => (r.kind === "add" || r.kind === "update" ? [r.record] : []));
}

// ───────── 書き出し ─────────

/** 列定義どおりの CSV（Excel で開ける UTF-8 BOM、改行 CRLF）。encoding="shift_jis" も選べる */
export function exportCsv<T>(defT: MasterDef<T>, rows: object[], encoding: "utf-8" | "shift_jis" = "utf-8"): Buffer {
  const def = defT as unknown as MasterDef;
  const text = tableToCsv(itemsToTable(def, rows as Record<string, unknown>[]));
  return encoding === "shift_jis" ? iconv.encode(text, "Shift_JIS") : Buffer.from("﻿" + text, "utf8");
}

/** 空のひな形（見出し＋例の行）。例の行は「例:」で始めるので、そのまま取り込むとエラーになって気づける */
export function templateCsv<T>(defT: MasterDef<T>): Buffer {
  const def = defT as unknown as MasterDef;
  const [head, ex] = templateTable(def);
  const headMarked = head.map((h, i) => h + (def.columns[i].required ? "（必須）" : ""));
  const exMarked = ex.map((v, i) => (i === 0 ? `例:${v}` : v));
  return Buffer.from("﻿" + tableToCsv([headMarked, exMarked]), "utf8");
}

// ───────── 個別の編集 ─────────

/**
 * 画面のフォームの1件（項目 key → 文字）を、CSV と同じ決まりで検証する。
 * base があれば更新（フォームにある項目だけ差し替え）、無ければ新規。
 */
export function validateForm<T>(defT: MasterDef<T>, input: Record<string, string>, base: Rec | undefined, existing: Rec[], all: Partial<Masters>): { record?: Rec; errors: RowError[] } {
  const def = defT as unknown as MasterDef;
  const cols = def.columns.filter((c) => c.key in input || (base && def.keyColumns.includes(c.key)));
  const header = cols.map((c) => c.label);
  const cells = cols.map((c) => (base && def.keyColumns.includes(c.key) ? formatCell(c, base[c.key]) : (input[c.key] ?? "")));
  const buf = Buffer.from("﻿" + tableToCsv([header, cells]), "utf8");
  const p = previewCsv(def, buf, existing, all);
  const r = p.rows[0];
  if (p.fileErrors.length) return { errors: p.fileErrors.map((m) => ({ column: "", message: m })) };
  if (!r) return { errors: [{ column: "", message: "入力がありません" }] };
  if (r.kind === "error") return { errors: r.errors };
  if (!base && r.kind !== "add") return { errors: [{ column: def.keyColumns.join("・"), message: "同じ ID がもうあります" }] };
  return { record: r.record, errors: [] };
}
