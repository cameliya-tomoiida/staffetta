import "server-only";
// 衛生管理（⑦の(21)）の保存。
//   シートの決まり … kv の hygiene_sheets（無ければ DEFAULT_SHEETS）。画面で項目を直せる
//   月の記録     … hygiene_records（シート × 月 で1行。変えた記録は hygiene_record_log）
//   マニュアル   … hygiene_manuals（名前・分類・版）と、ファイルは data/hygiene-manuals/（git の外）
//   休業日       … kv の factory_holidays（日付の一覧）があれば使う（①の工場の休業日ができたら、そちらに合わせる）
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, ensureTables, getDb, kvGet, kvSet } from "@/lib/db/sqlite";
import { DEFAULT_SHEETS, type SheetDef, type SheetRecord } from "./sheets";

const SQL = `
CREATE TABLE IF NOT EXISTS hygiene_records (
  sheet_id TEXT NOT NULL,
  month TEXT NOT NULL,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (sheet_id, month)
);
CREATE TABLE IF NOT EXISTS hygiene_record_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  sheet_id TEXT NOT NULL,
  month TEXT NOT NULL,
  json TEXT NOT NULL,
  at TEXT NOT NULL,
  who TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hygiene_manuals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  stored TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  uploaded_by TEXT NOT NULL
);
`;
const init = () => ensureTables("hygiene", SQL);

// ───────── シートの決まり ─────────

export function listSheets(opts: { all?: boolean } = {}): SheetDef[] {
  const saved = kvGet<SheetDef[]>("hygiene_sheets");
  const list = saved?.length ? saved : DEFAULT_SHEETS;
  return opts.all ? list : list.filter((s) => s.active !== false);
}

export function getSheet(id: string) {
  return listSheets({ all: true }).find((s) => s.id === id);
}

/** シートを直す・足す（id が同じなら置きかえ） */
export function saveSheet(def: SheetDef) {
  const list = listSheets({ all: true });
  const i = list.findIndex((s) => s.id === def.id);
  const next = i >= 0 ? list.map((s, j) => (j === i ? def : s)) : [...list, def];
  kvSet("hygiene_sheets", next);
}

/** はじめのシートに戻す（直したものを消す） */
export function resetSheets() {
  kvSet("hygiene_sheets", undefined);
}

export function holidaysOf(month: string): string[] {
  return (kvGet<string[]>("factory_holidays") ?? []).filter((d) => d.startsWith(month));
}

// ───────── 月の記録 ─────────

export function getRecord(sheetId: string, month: string): { rec: SheetRecord; updatedAt?: string; updatedBy?: string } {
  init();
  const r = getDb().prepare("SELECT json, updated_at, updated_by FROM hygiene_records WHERE sheet_id = ? AND month = ?").get(sheetId, month) as
    | { json: string; updated_at: string; updated_by: string }
    | undefined;
  return r ? { rec: JSON.parse(r.json) as SheetRecord, updatedAt: r.updated_at, updatedBy: r.updated_by } : { rec: {} };
}

export function recordsOf(month: string): Map<string, SheetRecord> {
  init();
  const rows = getDb().prepare("SELECT sheet_id, json FROM hygiene_records WHERE month = ?").all(month) as { sheet_id: string; json: string }[];
  return new Map(rows.map((r) => [r.sheet_id, JSON.parse(r.json) as SheetRecord]));
}

/** 記録を保存（月ごとに責任者が確認したら、確認を外すまで直せない） */
export function saveRecord(sheetId: string, month: string, rec: SheetRecord, who: string) {
  init();
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("月は 2026-11 の形で");
  if (!getSheet(sheetId)) throw new Error("シートが見つかりません");
  const cur = getRecord(sheetId, month).rec;
  if (cur.approvedBy) throw new Error("責任者が確認した月です。直すときは、先に確認を外してください");
  // 責任者の確認は approveRecord だけで変える
  const { approvedBy: _a, approvedAt: _b, ...rest } = rec;
  void [_a, _b];
  const now = new Date().toISOString();
  const json = JSON.stringify(rest);
  getDb()
    .prepare(
      `INSERT INTO hygiene_records (sheet_id, month, json, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(sheet_id, month) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .run(sheetId, month, json, now, who);
  getDb().prepare("INSERT INTO hygiene_record_log (sheet_id, month, json, at, who) VALUES (?, ?, ?, ?, ?)").run(sheetId, month, json, now, who);
}

/** 責任者の確認（who が空なら外す） */
export function approveRecord(sheetId: string, month: string, who: string) {
  const cur = getRecord(sheetId, month).rec;
  const next: SheetRecord = { ...cur };
  if (who) {
    next.approvedBy = who;
    next.approvedAt = new Date().toISOString();
  } else {
    delete next.approvedBy;
    delete next.approvedAt;
  }
  // 確認の切りかえは、確認済みでも通す
  init();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO hygiene_records (sheet_id, month, json, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(sheet_id, month) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .run(sheetId, month, JSON.stringify(next), now, who || "（確認を外す）");
}

// ───────── マニュアル ─────────

export interface Manual {
  id: string;
  name: string;
  category: string;
  version: string;
  note: string;
  fileName: string;
  mime: string;
  size: number;
  uploadedAt: string;
  uploadedBy: string;
}

const MANUAL_DIR = () => path.join(process.env.HUB_DB_PATH === ":memory:" ? path.join(DATA_DIR, "test-tmp") : DATA_DIR, "hygiene-manuals");
/** 10MB まで（取りつぎ（proxy）が受けるのが 10MB まで） */
export const MANUAL_MAX_BYTES = 10 * 1024 * 1024;
const OK_TYPES = /\.(pdf|xlsx|xlsm|xls|docx|doc|png|jpe?g|gif|webp|heic)$/i;

export function listManuals(): Manual[] {
  init();
  const rows = getDb().prepare("SELECT * FROM hygiene_manuals ORDER BY category, name").all() as Record<string, string | number>[];
  return rows.map((r) => ({
    id: String(r.id), name: String(r.name), category: String(r.category), version: String(r.version), note: String(r.note), fileName: String(r.file_name),
    mime: String(r.mime), size: Number(r.size), uploadedAt: String(r.uploaded_at), uploadedBy: String(r.uploaded_by),
  }));
}

export function addManual(input: { name: string; category: string; version?: string; note?: string; fileName: string; mime: string; bytes: Uint8Array }, who: string): Manual {
  init();
  if (!input.name.trim()) throw new Error("名前を入れてください");
  if (!OK_TYPES.test(input.fileName)) throw new Error("PDF・Excel・Word・画像（png・jpg）のファイルにしてください");
  if (input.bytes.byteLength > MANUAL_MAX_BYTES) throw new Error("ファイルが大きすぎます（10MB まで）");
  const id = randomUUID().slice(0, 8);
  const ext = path.extname(input.fileName).toLowerCase();
  mkdirSync(MANUAL_DIR(), { recursive: true });
  const stored = `${id}${ext}`;
  writeFileSync(path.join(MANUAL_DIR(), stored), input.bytes);
  const m: Manual = {
    id, name: input.name.trim(), category: input.category.trim() || "その他", version: (input.version ?? "").trim(), note: (input.note ?? "").trim(),
    fileName: input.fileName, mime: input.mime || "application/octet-stream", size: input.bytes.byteLength, uploadedAt: new Date().toISOString(), uploadedBy: who,
  };
  getDb()
    .prepare("INSERT INTO hygiene_manuals (id, name, category, version, note, file_name, mime, size, stored, uploaded_at, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(m.id, m.name, m.category, m.version, m.note, m.fileName, m.mime, m.size, stored, m.uploadedAt, m.uploadedBy);
  return m;
}

export function readManual(id: string): { manual: Manual; bytes: Buffer } | undefined {
  init();
  const r = getDb().prepare("SELECT stored FROM hygiene_manuals WHERE id = ?").get(id) as { stored: string } | undefined;
  const m = listManuals().find((x) => x.id === id);
  if (!r || !m) return undefined;
  return { manual: m, bytes: readFileSync(path.join(MANUAL_DIR(), r.stored)) };
}

export function deleteManual(id: string) {
  init();
  const r = getDb().prepare("SELECT stored FROM hygiene_manuals WHERE id = ?").get(id) as { stored: string } | undefined;
  if (!r) return;
  getDb().prepare("DELETE FROM hygiene_manuals WHERE id = ?").run(id);
  rmSync(path.join(MANUAL_DIR(), r.stored), { force: true });
}
