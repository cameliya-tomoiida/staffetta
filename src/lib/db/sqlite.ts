// 受発注ハブの保存先（SQLite）。Node 24 標準の node:sqlite を使う（追加パッケージなし）。
//
// 置き場所: data/hub.sqlite（git には入れない）。HUB_DB_PATH で変えられる（テスト用）。
// 使い方（ほかの担当も同じ）:
//   import { getDb, ensureTables } from "@/lib/db/sqlite";
//   ensureTables("line", `CREATE TABLE IF NOT EXISTS line_users (...);`);  // モジュールごとに1回。何度呼んでもよい
//   getDb().prepare("SELECT ...").all();
// 書き込みをまとめるときは transaction(() => { ... }) を使う。
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { migrateRenamedNames } from "./rename-migration";

export const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = process.env.HUB_DB_PATH ?? path.join(DATA_DIR, "hub.sqlite");

// 開発サーバーの作り直し（HMR）でも接続を使い回すため globalThis に置く
const g = globalThis as unknown as { __hubDb?: DatabaseSync; __hubSchemas?: Set<string> };

export function getDb(): DatabaseSync {
  if (!g.__hubDb) {
    if (DB_PATH !== ":memory:") mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new DatabaseSync(DB_PATH);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
    g.__hubDb = db;
    g.__hubSchemas = new Set();
    // 公開前の名前の付け替え（実在の社名 → 架空の名前）を、古い DB に1回だけ当てる（⑤。kv に済みの印）
    migrateRenamedNames(db, DB_PATH === ":memory:" ? undefined : path.dirname(DB_PATH));
  }
  return g.__hubDb;
}

/** テーブルを作る（CREATE TABLE IF NOT EXISTS ...）。name ごとにプロセスで1回だけ実行する */
export function ensureTables(name: string, sql: string) {
  const db = getDb();
  if (g.__hubSchemas!.has(name)) return;
  db.exec(sql);
  g.__hubSchemas!.add(name);
}

/** まとめて書き込む（途中で失敗したら全部取り消す） */
export function transaction<T>(fn: () => T): T {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** 設定や小さなデータの置き場（key → JSON）。settings・取り込み済みID など */
const KV_SQL = `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL);`;

export function kvGet<T>(key: string): T | undefined {
  ensureTables("kv", KV_SQL);
  const row = getDb().prepare("SELECT json FROM kv WHERE key = ?").get(key) as { json: string } | undefined;
  return row ? (JSON.parse(row.json) as T) : undefined;
}

export function kvSet(key: string, value: unknown) {
  ensureTables("kv", KV_SQL);
  if (value === undefined) {
    getDb().prepare("DELETE FROM kv WHERE key = ?").run(key);
    return;
  }
  getDb()
    .prepare("INSERT INTO kv (key, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at")
    .run(key, JSON.stringify(value), new Date().toISOString());
}

/** 全テーブルの名前（バックアップ用） */
export function tableNames(): string[] {
  return (getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
}
