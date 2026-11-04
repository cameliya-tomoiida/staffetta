// 受信FAX・注文・発注書・FAXの様式を SQLite に保存する（store.ts の中身）。
// Next.js に依存しない（scripts/demo-reset.ts やテストからも使える）。
//
// テーブル
//   faxes(id, received_at, status, customer_id, json)
//   orders(id, customer_id, delivery_date, status, channel, intent, created_at, json)
//   purchase_orders(id, supplier_id, delivery_date, status, created_at, json)
//   imported_messages(message_id, at)          … Gmail から受け取り済み（二重取り込み防止）
//   masters(name = "fax_formats")              … 承認済みの FAX の様式（無効化できる）。masters.ts の共通の口
//   kv("fax_mappings")                         … 得意先ごとの「書類の品名 → 商品」
//   kv("loss_rates")                           … 承認したロス率
//
// 1か月・1年・3年とたまっても、日付・取引先・状態の列に索引があるので検索できる（search.ts）。
import { existsSync, promises as fs, renameSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Order, PurchaseOrder } from "@/data/types";
import type { Db, FaxDoc, FaxTemplate } from "../types";
import { demoDb } from "../demo-reset";
import { emptyDb } from "./initial";
import { initMasters, listMaster, upsertMasters } from "./masters";
import { DATA_DIR, ensureTables, getDb, kvGet, kvSet, transaction } from "./sqlite";

const SQL = `
CREATE TABLE IF NOT EXISTS faxes (
  id TEXT PRIMARY KEY, received_at TEXT NOT NULL, status TEXT NOT NULL, customer_id TEXT, json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS faxes_by_date ON faxes (received_at);
CREATE INDEX IF NOT EXISTS faxes_by_customer ON faxes (customer_id, received_at);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, customer_id TEXT, delivery_date TEXT NOT NULL, status TEXT NOT NULL,
  channel TEXT NOT NULL, intent TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL, json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_by_date ON orders (delivery_date);
CREATE INDEX IF NOT EXISTS orders_by_customer ON orders (customer_id, delivery_date);
CREATE INDEX IF NOT EXISTS orders_by_status ON orders (status, delivery_date);
CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY, supplier_id TEXT, delivery_date TEXT, status TEXT, created_at TEXT, json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS purchase_orders_by_date ON purchase_orders (delivery_date);
CREATE TABLE IF NOT EXISTS imported_messages (message_id TEXT PRIMARY KEY, at TEXT NOT NULL);
`;

export const FAX_FORMATS = "fax_formats";
type FormatRow = FaxTemplate & { id: string; disabled?: boolean };

function init() {
  ensureTables("hub", SQL);
  initMasters();
  kvGet("store_initialized"); // kv の表も先に作っておく（トランザクションの中で作らないように）
}

// ───────── 読み出し ─────────

function readRows<T>(table: string): T[] {
  return (getDb().prepare(`SELECT json FROM ${table}`).all() as { json: string }[]).map((r) => JSON.parse(r.json) as T);
}

/** 保存されている全データを、いままでの Db の形で返す */
export async function loadDb(): Promise<Db> {
  init();
  await migrateOnce();
  const formats = await listMaster<FormatRow>(FAX_FORMATS);
  const templates: Db["templates"] = {};
  for (const f of formats) {
    const { id: _id, disabled: _d, ...t } = f;
    templates[f.customerId] = t;
  }
  const db: Db = {
    faxes: readRows<FaxDoc>("faxes").sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id)),
    orders: readRows<Order>("orders").sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    purchaseOrders: readRows<PurchaseOrder>("purchase_orders"),
    importedMessageIds: (getDb().prepare("SELECT message_id FROM imported_messages ORDER BY at").all() as { message_id: string }[]).map((r) => r.message_id),
    templates,
    mappings: kvGet<Db["mappings"]>("fax_mappings") ?? {},
  };
  const loss = kvGet<Db["lossRates"]>("loss_rates");
  if (loss && typeof loss.rates === "object") db.lossRates = loss;
  return db;
}

// ───────── 書き込み（変わった行だけ） ─────────

const channelOf = (o: Order) => o.source?.channel ?? "manual";

function upsertFax(f: FaxDoc) {
  getDb()
    .prepare(`INSERT INTO faxes (id, received_at, status, customer_id, json) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET received_at = excluded.received_at, status = excluded.status, customer_id = excluded.customer_id, json = excluded.json`)
    .run(f.id, f.receivedAt, f.status, f.customerId ?? null, JSON.stringify(f));
}
function upsertOrder(o: Order) {
  getDb()
    .prepare(`INSERT INTO orders (id, customer_id, delivery_date, status, channel, intent, created_at, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET customer_id = excluded.customer_id, delivery_date = excluded.delivery_date, status = excluded.status,
              channel = excluded.channel, intent = excluded.intent, created_at = excluded.created_at, json = excluded.json`)
    .run(o.id, o.customerId || null, o.deliveryDate, o.status, channelOf(o), o.intent ?? "new", o.createdAt, JSON.stringify(o));
}
function upsertPurchase(p: PurchaseOrder & { createdAt?: string }) {
  getDb()
    .prepare(`INSERT INTO purchase_orders (id, supplier_id, delivery_date, status, created_at, json) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET supplier_id = excluded.supplier_id, delivery_date = excluded.delivery_date, status = excluded.status,
              created_at = excluded.created_at, json = excluded.json`)
    .run(p.id, p.supplierId ?? null, p.deliveryDate ?? null, p.status ?? null, p.createdAt ?? null, JSON.stringify(p));
}

function diffById<T extends { id: string }>(before: T[], after: T[], upsert: (x: T) => void, table: string) {
  const old = new Map(before.map((x) => [x.id, JSON.stringify(x)]));
  const seen = new Set<string>();
  for (const x of after) {
    seen.add(x.id);
    if (old.get(x.id) !== JSON.stringify(x)) upsert(x);
  }
  const del = getDb().prepare(`DELETE FROM ${table} WHERE id = ?`);
  for (const id of old.keys()) if (!seen.has(id)) del.run(id);
}

/** before（読んだ時点）と after（書き換え後）を比べて、変わった所だけ保存する */
export async function saveDiff(before: Db, after: Db) {
  init();
  // 様式（masters）は別のトランザクション（masters.ts が自前で持つ）
  const formatRows: FormatRow[] = [];
  for (const [cid, t] of Object.entries(after.templates ?? {})) {
    if (JSON.stringify(before.templates?.[cid]) !== JSON.stringify(t)) formatRows.push({ id: cid, ...t });
  }
  transaction(() => {
    diffById(before.faxes, after.faxes, upsertFax, "faxes");
    diffById(before.orders, after.orders, upsertOrder, "orders");
    diffById(before.purchaseOrders ?? [], after.purchaseOrders ?? [], upsertPurchase, "purchase_orders");
    const had = new Set(before.importedMessageIds);
    const ins = getDb().prepare("INSERT OR IGNORE INTO imported_messages (message_id, at) VALUES (?, ?)");
    for (const m of after.importedMessageIds ?? []) if (!had.has(m)) ins.run(m, new Date().toISOString());
    if (JSON.stringify(before.mappings) !== JSON.stringify(after.mappings)) kvSet("fax_mappings", after.mappings ?? {});
    if (JSON.stringify(before.lossRates) !== JSON.stringify(after.lossRates)) kvSet("loss_rates", after.lossRates);
  });
  for (const f of formatRows) await upsertMasters(FAX_FORMATS, [f], f.approvedBy || "（不明）");
}

// ───────── まとめて入れ替え（移行・リセット・取り込み） ─────────

/** 受信FAX・注文・発注書・様式・対応表を、渡した Db の内容に入れ替える */
export async function replaceAll(db: Db, who: string) {
  init();
  transaction(() => {
    for (const t of ["faxes", "orders", "purchase_orders", "imported_messages"]) getDb().exec(`DELETE FROM ${t}`);
    getDb().exec(`DELETE FROM masters WHERE name = '${FAX_FORMATS}'`);
    for (const f of db.faxes) upsertFax(f);
    for (const o of db.orders) upsertOrder(o);
    for (const p of db.purchaseOrders ?? []) upsertPurchase(p);
    const ins = getDb().prepare("INSERT OR IGNORE INTO imported_messages (message_id, at) VALUES (?, ?)");
    for (const m of db.importedMessageIds ?? []) ins.run(m, new Date().toISOString());
    kvSet("fax_mappings", db.mappings ?? {});
    kvSet("loss_rates", db.lossRates);
  });
  const rows = Object.entries(db.templates ?? {}).map(([cid, t]) => ({ id: cid, ...t }));
  if (rows.length) await upsertMasters(FAX_FORMATS, rows, who);
}

/** デモの最初の状態（受信箱 F001〜F005・デモ注文・発注書なし・いつもの3社の様式）にする */
export async function resetToDemo() {
  await replaceAll(demoDb(emptyDb()), "デモを最初から");
  kvSet("store_initialized", { at: new Date().toISOString(), from: "demo" });
}

/** 初めて開いたとき: data/db.json があれば取り込み（名前を変えて残す）、無ければデモの状態で始める */
let migrating: Promise<void> | null = null;
async function migrateOnce() {
  if (kvGet("store_initialized")) return;
  migrating ??= (async () => {
    const jsonPath = path.join(DATA_DIR, "db.json");
    if (existsSync(jsonPath)) {
      const old = JSON.parse(readFileSync(jsonPath, "utf8")) as Db;
      old.templates ??= {};
      old.mappings ??= {};
      old.importedMessageIds ??= [];
      old.purchaseOrders ??= [];
      await replaceAll(old, "db.json から移行");
      renameSync(jsonPath, path.join(DATA_DIR, `db.json.migrated-${new Date().toISOString().slice(0, 10)}`));
      kvSet("store_initialized", { at: new Date().toISOString(), from: "db.json" });
    } else {
      await resetToDemo();
    }
  })();
  await migrating;
}

/** 受信したFAXのPDFを置く場所（git には入れない） */
export const FAX_INBOX_DIR = path.join(DATA_DIR, "fax-inbox");

export async function clearFaxInbox() {
  await fs.rm(FAX_INBOX_DIR, { recursive: true, force: true });
  await fs.mkdir(FAX_INBOX_DIR, { recursive: true });
}
