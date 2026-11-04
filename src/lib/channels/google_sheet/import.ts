import "server-only";
// Google スプレッドシートの注文表（店舗別・月別シート。行＝納品日、列＝商品、セル＝ケース数）を読む。
//
// 読み方は2通り（どちらにするかは担当者が決める。docs/google-sheet-auth.md）
//  A. 公開CSV（リンクを知っている人が閲覧可 → CSV で出す URL を読む）… 設定がいちばん楽。鍵は要らない
//  B. サービスアカウント（シートをサービスアカウントのメールに共有 → Sheets API で読む）… 外に公開しなくてよい
// デモでは「demo:」で始まる URL のとき、public/samples/inbound/sheet/ の架空シートを読む。
//
// - 前回読んだ値を data/channels.json に覚えておき、セルごとの差分（増えた・減った・消えた）を出す
// - 要確認のままの注文は読み直しで置き換える。人が確定済みの日に差分が出たら「変更」の注文を別に作る（確定済みは書き換えない）
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { readDb } from "@/lib/store";
import { sheetColumnMap } from "@/lib/masters/channel-settings";
import { DEMO_SHEETS, SHEET_COLUMN_MAP, type SheetSpec } from "./config";
import { guessProduct, parseCsv, readChannelState, saveImported, toIsoDate, writeChannelState, type ImportedOrder } from "../common";
import { nowIso } from "@/lib/clock";



export type Grid = string[][];
export type Snapshot = Record<string, number>; // "YYYY-MM-DD|列見出し" → 数

export interface CellDiff {
  date: string;
  column: string;
  before: number | null; // null = 前回はなかった
  after: number | null; // null = 今回はなくなった
}

/** シートの id を URL から取り出す */
export function sheetIdFromUrl(url: string) {
  return url.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1];
}

/** A. 公開CSV の URL（gviz の CSV 出力。シート名と範囲を指定できる） */
export function publicCsvUrl(spec: SheetSpec) {
  const id = sheetIdFromUrl(spec.url);
  if (!id) throw new Error("スプレッドシートのURLが読めません");
  const q = new URLSearchParams({ tqx: "out:csv", sheet: spec.sheetName });
  if (spec.range) q.set("range", spec.range);
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?${q}`;
}

export async function fetchGrid(spec: SheetSpec): Promise<Grid> {
  if (spec.url.startsWith("demo:")) {
    const name = path.basename(spec.url.slice(5));
    const file = path.join(process.cwd(), "public", "samples", "inbound", "sheet", name);
    return parseCsv(await fs.readFile(file, "utf8"));
  }
  // B. サービスアカウントを使う場合は、ここを Sheets API（spreadsheets.values.get）に差し替える
  const res = await fetch(publicCsvUrl(spec), { cache: "no-store" });
  if (!res.ok) throw new Error(`シートを読めませんでした（${res.status}）。共有設定を確認してください`);
  const text = await res.text();
  if (text.trimStart().startsWith("<")) throw new Error("シートが公開されていません（ログイン画面が返ってきました）");
  return parseCsv(text);
}

/** 表を「納品日×列見出し→数」にする。1行目が見出し、1列目が納品日。数字でないセル・0 は注文なしとして飛ばす */
export function gridToSnapshot(grid: Grid): { snapshot: Snapshot; columns: string[]; notes: Record<string, string> } {
  const [head, ...rows] = grid;
  const columns: string[] = [];
  const snapshot: Snapshot = {};
  const notes: Record<string, string> = {};
  const skip = /^(納品日|日付|曜日|備考|メモ)$/;
  for (const r of rows) {
    const date = toIsoDate(r[0] ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    head.forEach((h, ci) => {
      const col = h.trim();
      if (ci === 0 || !col) return;
      if (/^(備考|メモ)$/.test(col)) {
        if (r[ci]?.trim()) notes[date] = r[ci].trim();
        return;
      }
      if (skip.test(col)) return;
      if (!columns.includes(col)) columns.push(col);
      const v = Number((r[ci] ?? "").replace(/[,，\s]/g, "").normalize("NFKC"));
      if (Number.isFinite(v) && v > 0) snapshot[`${date}|${col}`] = v;
    });
  }
  return { snapshot, columns, notes };
}

export function diffSnapshots(before: Snapshot | undefined, after: Snapshot): CellDiff[] {
  if (!before) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: CellDiff[] = [];
  for (const k of [...keys].sort()) {
    const b = before[k] ?? null;
    const a = after[k] ?? null;
    if (b !== a) {
      const [date, column] = k.split("|");
      out.push({ date, column, before: b, after: a });
    }
  }
  return out;
}

const keyOf = (spec: SheetSpec) => `sheet:${spec.customerId}:${spec.sheetName}`;
const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 8);

export interface SheetImportResult {
  sheet: string;
  firstTime: boolean;
  diffs: CellDiff[];
  orderIds: string[];
  changeOrderIds: string[];
  readAt: string;
}

export async function importSheet(spec: SheetSpec): Promise<SheetImportResult> {
  const grid = await fetchGrid(spec);
  const { snapshot, notes } = gridToSnapshot(grid);
  const key = keyOf(spec);
  const prev = await readChannelState<{ snapshot: Snapshot; readAt: string }>(key);
  const diffs = diffSnapshots(prev?.snapshot, snapshot);
  const readAt = nowIso();
  // 列見出し → 商品と入数は、マスタ「シートの列と商品」から（画面で変えられる）
  const colMap: Record<string, { productId: string; piecesPerUnit: number; unit: string }> = await sheetColumnMap(spec.customerId);
  const base = `GS${hash(key)}`;
  const db = await readDb();

  const dates = [...new Set(Object.keys(snapshot).map((k) => k.split("|")[0]).concat(diffs.map((d) => d.date)))].sort();
  const list: ImportedOrder[] = [];
  const changeIds: string[] = [];
  const lineFor = (column: string, qty: number, attention = "") => {
    const m = colMap[column];
    const g = m ? { productId: m.productId, exact: true } : guessProduct(column);
    return {
      writtenName: column,
      productId: g.productId,
      quantity: qty,
      unitWritten: m?.unit ?? "ケース",
      piecesPerUnit: m?.piecesPerUnit ?? 1,
      confidence: m ? 1 : g.productId ? 0.6 : 0.3,
      attention: [m ? "" : "列見出しが様式にありません（商品と入数を確認）", attention].filter(Boolean).join("・"),
    };
  };

  for (const date of dates) {
    const id = `${base}-${date}`;
    const source = {
      channel: "google_sheet" as const,
      refs: [{ kind: "google_sheet" as const, url: spec.url, sheetName: spec.sheetName, range: spec.range }],
      receivedAt: readAt,
      extra: { ...(notes[date] ? { notes: notes[date] } : {}), ...(prev ? { previousReadAt: prev.readAt } : {}) },
    };
    const cells = Object.entries(snapshot).filter(([k]) => k.startsWith(`${date}|`));
    const existing = db.orders.find((o) => o.id === id);
    if (existing && existing.status !== "needs_review") {
      // 人が確定・取消した日に差分が出た → 変更の注文として別に入れる（元は書き換えない）
      const ds = diffs.filter((d) => d.date === date);
      if (!ds.length) continue;
      const cid = `${id}-c${hash(readAt)}`;
      changeIds.push(cid);
      list.push({
        id: cid,
        customerId: spec.customerId,
        deliveryDate: date,
        deliveryPlace: spec.place,
        intent: "change",
        changeOf: existing.id,
        source,
        lines: ds.map((d) => lineFor(d.column, d.after ?? 0, `シートの値が変わりました ${d.before ?? "なし"} → ${d.after ?? "なし"}`)),
      });
      continue;
    }
    if (!cells.length) continue;
    list.push({
      id,
      customerId: spec.customerId,
      deliveryDate: date,
      deliveryPlace: spec.place,
      intent: "new",
      source,
      lines: cells.map(([k, v]) => {
        const column = k.split("|")[1];
        const d = diffs.find((x) => x.date === date && x.column === column);
        return lineFor(column, v, d ? `前回 ${d.before ?? "なし"} → 今回 ${d.after}` : "");
      }),
    });
  }
  const saved = await saveImported(list);
  await writeChannelState(key, { snapshot, readAt });
  return { sheet: spec.sheetName, firstTime: !prev, diffs, orderIds: saved.ids, changeOrderIds: changeIds, readAt };
}

export { DEMO_SHEETS, SHEET_COLUMN_MAP, type SheetSpec };
