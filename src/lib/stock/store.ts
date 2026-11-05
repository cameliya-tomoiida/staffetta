import "server-only";
// 材料・包材の在庫の出入り（⑤）。在庫の数そのものは①のマスタ（materials・packaging の stock）にあり、③の計算はそこを読む。
// ここは「何で・いつ・誰が・いくつ動かしたか」を1件ずつ残し、在庫の数を足し引きする。
//   入荷（receive）   … 送信済みの発注書が届いた。数は直せる → 在庫に足す
//   使用（use）       … その日の製造を「作り終えた」。レシピ×製造数（ロス込み）と商品の包材 → 在庫から引く
//   棚卸（stocktake） … 数えた実数に直した差
// 同じ発注書・同じ製造日をもう一度記録したら、前の記録との差だけ動かす（数を直せる・二重に引かない）。
import type { Masters } from "@/data/types";
import { nowIso } from "@/lib/clock";
import { getMaster, upsertMasters } from "@/lib/db/masters";
import { ensureTables, getDb } from "@/lib/db/sqlite";
import { loadMasters, seedSampleMasters } from "@/lib/masters/seed-db";
import { getPurchaseOrder } from "@/lib/purchase-store";
import { productionUsage, type MadeItem, type Usage } from "./usage";

export type StockMaster = "materials" | "packaging";
export type MoveKind = "receive" | "use" | "stocktake";

export interface StockMove {
  seq: number;
  at: string;
  who: string;
  kind: MoveKind;
  master: StockMaster;
  itemId: string;
  /** 足した数（引いたらマイナス）。在庫の単位 */
  qty: number;
  before: number;
  after: number;
  /** 発注書 ID・製造日など */
  ref: string;
  note: string;
}

const SQL = `
CREATE TABLE IF NOT EXISTS stock_moves (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL, who TEXT NOT NULL, kind TEXT NOT NULL, master TEXT NOT NULL, item_id TEXT NOT NULL,
  qty REAL NOT NULL, before REAL NOT NULL, after REAL NOT NULL, ref TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS stock_moves_item ON stock_moves (master, item_id, seq);
CREATE TABLE IF NOT EXISTS stock_events (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, json TEXT NOT NULL, at TEXT NOT NULL, who TEXT NOT NULL
);`;
const init = () => ensureTables("stock", SQL);
let seeded = false;
/** マスタがまだ空なら③のサンプルを入れる（空のときだけ） */
async function ready() {
  init();
  if (!seeded) {
    await seedSampleMasters();
    seeded = true;
  }
}
const round = (n: number) => Math.round(n * 1000) / 1000;

/** 1つの記録（入荷・製造の実績）。今の値を返す */
function getEvent<T>(id: string): (T & { at: string; who: string }) | undefined {
  init();
  const r = getDb().prepare("SELECT json, at, who FROM stock_events WHERE id = ?").get(id) as { json: string; at: string; who: string } | undefined;
  return r ? { ...(JSON.parse(r.json) as T), at: r.at, who: r.who } : undefined;
}
function putEvent(id: string, kind: string, value: unknown, who: string) {
  init();
  getDb()
    .prepare("INSERT INTO stock_events (id, kind, json, at, who) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, at = excluded.at, who = excluded.who")
    .run(id, kind, JSON.stringify(value), nowIso(), who);
}

/** 在庫を動かす（マスタの stock を足し引きし、動きを1件ずつ残す）。在庫は 0 より下にしない（足りなかった分はメモに残す） */
async function move(kind: MoveKind, items: { master: StockMaster; itemId: string; qty: number }[], who: string, ref: string, note = ""): Promise<StockMove[]> {
  await ready();
  const at = nowIso();
  const out: StockMove[] = [];
  for (const it of items) {
    if (!it.qty) continue;
    const cur = await getMaster<{ id: string; stock?: number }>(it.master, it.itemId);
    if (!cur) continue;
    const before = Number(cur.stock ?? 0);
    const raw = round(before + it.qty);
    const after = Math.max(0, raw);
    const n = raw < 0 ? [note, `在庫が ${round(-raw)} 足りませんでした（0 にしました）`].filter(Boolean).join("・") : note;
    await upsertMasters(it.master, [{ ...cur, stock: after }], `${who}（${kind === "receive" ? "入荷" : kind === "use" ? "製造で使用" : "棚卸"}）`);
    const r = getDb()
      .prepare("INSERT INTO stock_moves (at, who, kind, master, item_id, qty, before, after, ref, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(at, who, kind, it.master, it.itemId, round(it.qty), before, after, ref, n);
    out.push({ seq: Number(r.lastInsertRowid), at, who, kind, master: it.master, itemId: it.itemId, qty: round(it.qty), before, after, ref, note: n });
  }
  return out;
}

/** 材料か包材か（ID で探す） */
async function masterOf(itemId: string): Promise<StockMaster | undefined> {
  await ready();
  if (await getMaster("materials", itemId)) return "materials";
  if (await getMaster("packaging", itemId)) return "packaging";
  return undefined;
}

// ───────── 入荷 ─────────
export interface ReceiptLine {
  itemId: string;
  /** 届いた量（在庫の単位: kg・個 など） */
  quantity: number;
}
export interface Receipt {
  poId: string;
  lines: ReceiptLine[];
  note?: string;
}

export async function getReceipt(poId: string) {
  return getEvent<Receipt>(`receive:${poId}`);
}

/**
 * 発注書が届いた（入荷）。送信済みの発注書だけ。届いた量は直せる（初期値は発注した量）。
 * 2回目は前の記録との差だけ在庫を動かす。
 */
export async function receivePurchaseOrder(poId: string, lines: ReceiptLine[] | undefined, who: string, note?: string) {
  if (!who.trim()) throw new Error("入荷を記録する人を選んでください");
  const po = await getPurchaseOrder(poId);
  if (!po) throw new Error("発注書が見つかりません");
  if (po.status !== "sent") throw new Error("送信済みの発注書だけ入荷にできます");
  const want = (lines ?? po.lines.filter((l) => l.itemType === "material").map((l) => ({ itemId: l.itemId, quantity: l.quantity }))).map((l) => ({
    itemId: l.itemId,
    quantity: Number(l.quantity),
  }));
  for (const l of want) if (!Number.isFinite(l.quantity) || l.quantity < 0) throw new Error(`${l.itemId} の数は 0 以上の数で入れてください`);
  const prev = await getReceipt(poId);
  const prevQty = new Map((prev?.lines ?? []).map((l) => [l.itemId, l.quantity]));
  const items: { master: StockMaster; itemId: string; qty: number }[] = [];
  for (const id of new Set([...want.map((l) => l.itemId), ...prevQty.keys()])) {
    const master = await masterOf(id);
    if (!master) continue; // 仕入品（商品）は在庫を持たない
    const delta = (want.find((l) => l.itemId === id)?.quantity ?? 0) - (prevQty.get(id) ?? 0);
    if (delta) items.push({ master, itemId: id, qty: delta });
  }
  const moves = await move("receive", items, who, poId, prev ? "入荷の数を直した" : (note ?? ""));
  putEvent(`receive:${poId}`, "receive", { poId, lines: want, ...(note ? { note } : {}) } satisfies Receipt, who);
  return { moves, receipt: await getReceipt(poId) };
}

// ───────── 製造の実績 ─────────
export interface ProductionActual {
  date: string;
  made: MadeItem[];
  usage: Usage;
}

export async function getProductionActual(date: string) {
  return getEvent<ProductionActual>(`production:${date}`);
}

/**
 * その日の製造を「作り終えた」で確定する。作った数（商品ごと）から、使った材料・包材を在庫から引く。
 * 数を直してもう一度押すと、前の記録との差だけ動かす。
 */
export async function recordProduction(date: string, made: MadeItem[], who: string, masters?: Masters) {
  if (!who.trim()) throw new Error("記録する人を選んでください");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("製造日が正しくありません");
  for (const m of made) if (!Number.isFinite(m.pieces) || m.pieces < 0) throw new Error(`${m.productId} の数は 0 以上で入れてください`);
  const ms = masters ?? (await loadMasters());
  const usage = productionUsage(ms, made);
  const prev = await getProductionActual(date);
  const key = (master: StockMaster, id: string) => `${master}|${id}`;
  const prevUse = new Map<string, number>();
  for (const x of prev?.usage.materials ?? []) prevUse.set(key("materials", x.id), x.qty);
  for (const x of prev?.usage.packaging ?? []) prevUse.set(key("packaging", x.id), x.qty);
  const nowUse = new Map<string, number>();
  for (const x of usage.materials) nowUse.set(key("materials", x.id), x.qty);
  for (const x of usage.packaging) nowUse.set(key("packaging", x.id), x.qty);
  const items = [...new Set([...prevUse.keys(), ...nowUse.keys()])].map((k) => {
    const [master, itemId] = k.split("|") as [StockMaster, string];
    return { master, itemId, qty: -round((nowUse.get(k) ?? 0) - (prevUse.get(k) ?? 0)) };
  });
  const moves = await move("use", items, who, `製造 ${date}`, prev ? "製造の数を直した" : "");
  putEvent(`production:${date}`, "production", { date, made: made.filter((m) => m.pieces > 0), usage } satisfies ProductionActual, who);
  return { moves, usage, actual: await getProductionActual(date) };
}

// ───────── 棚卸・記録の読み出し ─────────
/** 棚卸の差を記録する（在庫の数はマスタ側の棚卸で直す。ここは動きの記録だけ） */
export function logStocktake(master: StockMaster, itemId: string, before: number, after: number, who: string, note?: string) {
  init();
  if (before === after) return;
  getDb()
    .prepare("INSERT INTO stock_moves (at, who, kind, master, item_id, qty, before, after, ref, note) VALUES (?, ?, 'stocktake', ?, ?, ?, ?, ?, '棚卸', ?)")
    .run(nowIso(), who, master, itemId, round(after - before), before, after, note ?? "");
}

/** 在庫の動き（新しい順）。itemId を省くとそのマスタ全部 */
export function listMoves(master: StockMaster, itemId?: string, limit = 200): StockMove[] {
  init();
  const rows = getDb()
    .prepare(`SELECT * FROM stock_moves WHERE master = ? ${itemId ? "AND item_id = ?" : ""} ORDER BY seq DESC LIMIT ?`)
    .all(...([master, ...(itemId ? [itemId] : []), limit] as (string | number)[])) as Record<string, unknown>[];
  return rows.map((r) => ({
    seq: Number(r.seq), at: String(r.at), who: String(r.who), kind: r.kind as MoveKind, master: r.master as StockMaster,
    itemId: String(r.item_id), qty: Number(r.qty), before: Number(r.before), after: Number(r.after), ref: String(r.ref), note: String(r.note),
  }));
}

/** 安全在庫を下回っている材料・包材（今日やることの帯・画面の注意に使う） */
export async function lowStockItems(masters?: Masters) {
  const m = masters ?? (await loadMasters());
  const pick = (master: StockMaster, rows: { id: string; name: string; unit: string; stock: number; safetyStock: number; supplierId?: string }[]) =>
    rows
      .filter((r) => r.safetyStock > 0 && r.stock < r.safetyStock)
      .map((r) => ({ master, id: r.id, name: r.name, unit: r.unit, stock: r.stock, safetyStock: r.safetyStock }));
  return [...pick("materials", m.materials as never), ...pick("packaging", m.packaging as never)];
}

/** デモを最初からにするとき（①の reset から呼ぶ）。入荷・製造の記録と在庫の動きを消す。在庫の数（マスタ）はそのまま */
export function resetStockRecords() {
  init();
  getDb().exec("DELETE FROM stock_events; DELETE FROM stock_moves;");
}
