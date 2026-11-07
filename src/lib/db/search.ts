// 注文・受信FAX・発注書の検索（月をまたいでたまり続けても、日付・取引先・状態で探せるように）。
// 画面（②）はこの関数か /api/search/* を使う。
//
// 期間 period
//   today  … 今日（日本時間）
//   week   … 今週（月曜〜日曜）
//   month  … 今月
//   recent … 既定。7日前〜これから先（古いものを一覧の既定から外す）
//   all    … 全部
//   custom … from / to（YYYY-MM-DD、両端を含む）
// 日付は 注文=納品日、FAX=受信日、発注書=納品日 で見る（注文は dateField: "created" で受けた日でも見られる）。
import type { Order, OrderChannel, OrderStatus, PurchaseOrder } from "@/data/types";
import type { FaxDoc, FaxStatus } from "../types";
import { todayJst } from "../clock";
import { getDb } from "./sqlite";
import { ensureStore } from "./hub-store";

export type Period = "today" | "week" | "month" | "recent" | "all" | "custom";

export interface SearchBase {
  period?: Period;
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  customerId?: string;
  /** 自由な言葉（品名・取引先名・メモなど。中身の JSON を部分一致で探す） */
  q?: string;
  limit?: number;
  offset?: number;
}

export interface SearchResult<T> {
  total: number;
  items: T[];
  range: { from: string | null; to: string | null };
}

const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** 期間 → 日付の範囲（日本時間の YYYY-MM-DD、両端を含む。null は制限なし） */
export function periodRange(period: Period = "recent", from?: string, to?: string): { from: string | null; to: string | null } {
  const today = todayJst();
  switch (period) {
    case "today":
      return { from: today, to: today };
    case "week": {
      const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0=日
      const monday = addDays(today, dow === 0 ? -6 : 1 - dow);
      return { from: monday, to: addDays(monday, 6) };
    }
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: addDays(`${addDays(`${today.slice(0, 7)}-28`, 4).slice(0, 7)}-01`, -1) };
    case "all":
      return { from: null, to: null };
    case "custom":
      return { from: from ?? null, to: to ?? null };
    case "recent":
    default:
      return { from: addDays(today, -7), to: null };
  }
}

/** 日本時間の日付 → 受信日時（UTC の ISO 文字列）と比べるための範囲 */
const jstStartIso = (ymd: string) => new Date(`${ymd}T00:00:00+09:00`).toISOString();
const jstEndIso = (ymd: string) => new Date(`${addDays(ymd, 1)}T00:00:00+09:00`).toISOString();

// 表の名前と並べ方は、決まった物だけ（文字でつなぐので、念のため一覧で確かめる）
const PAGE_TABLES = new Set(["orders", "faxes", "purchase_orders"]);
const PAGE_ORDERS = new Set(["delivery_date DESC, created_at DESC", "received_at DESC"]);

function page<T>(sqlWhere: string, args: (string | number)[], table: string, order: string, limit: number, offset: number) {
  if (!PAGE_TABLES.has(table) || !PAGE_ORDERS.has(order)) throw new Error(`検索できない表・並べ方です: ${table} / ${order}`);
  const db = getDb();
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${sqlWhere}`).get(...args) as { n: number }).n;
  const rows = db.prepare(`SELECT json FROM ${table} WHERE ${sqlWhere} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, limit, offset) as { json: string }[];
  return { total, items: rows.map((r) => JSON.parse(r.json) as T) };
}

export interface OrderSearch extends SearchBase {
  status?: OrderStatus | OrderStatus[];
  channel?: OrderChannel | OrderChannel[];
  /** 既定は new（変更・キャンセルの連絡の注文は含めない）。"all" で全部 */
  intent?: "new" | "change" | "cancel" | "all";
  dateField?: "delivery" | "created";
}

export async function searchOrders(s: OrderSearch = {}): Promise<SearchResult<Order>> {
  await ensureStore(); // 初回の移行・表の作成だけ（全部は読まない）
  const range = periodRange(s.period, s.from, s.to);
  const where: string[] = ["1=1"];
  const args: (string | number)[] = [];
  if (s.dateField === "created") {
    if (range.from) { where.push("created_at >= ?"); args.push(jstStartIso(range.from)); }
    if (range.to) { where.push("created_at < ?"); args.push(jstEndIso(range.to)); }
  } else {
    if (range.from) { where.push("delivery_date >= ?"); args.push(range.from); }
    if (range.to) { where.push("delivery_date <= ?"); args.push(range.to); }
  }
  if (s.customerId) { where.push("customer_id = ?"); args.push(s.customerId); }
  const statuses = s.status ? [s.status].flat() : [];
  if (statuses.length) { where.push(`status IN (${statuses.map(() => "?").join(",")})`); args.push(...statuses); }
  const channels = s.channel ? [s.channel].flat() : [];
  if (channels.length) { where.push(`channel IN (${channels.map(() => "?").join(",")})`); args.push(...channels); }
  if ((s.intent ?? "new") !== "all") { where.push("intent = ?"); args.push(s.intent ?? "new"); }
  if (s.q) { where.push("json LIKE ?"); args.push(`%${s.q}%`); }
  const r = page<Order>(where.join(" AND "), args, "orders", "delivery_date DESC, created_at DESC", s.limit ?? 200, s.offset ?? 0);
  return { ...r, range };
}

export interface FaxSearch extends SearchBase {
  status?: FaxStatus | FaxStatus[];
}

export async function searchFaxes(s: FaxSearch = {}): Promise<SearchResult<FaxDoc>> {
  await ensureStore();
  const range = periodRange(s.period, s.from, s.to);
  const where: string[] = ["1=1"];
  const args: (string | number)[] = [];
  if (range.from) { where.push("received_at >= ?"); args.push(jstStartIso(range.from)); }
  if (range.to) { where.push("received_at < ?"); args.push(jstEndIso(range.to)); }
  if (s.customerId) { where.push("customer_id = ?"); args.push(s.customerId); }
  const statuses = s.status ? [s.status].flat() : [];
  if (statuses.length) { where.push(`status IN (${statuses.map(() => "?").join(",")})`); args.push(...statuses); }
  if (s.q) { where.push("json LIKE ?"); args.push(`%${s.q}%`); }
  const r = page<FaxDoc>(where.join(" AND "), args, "faxes", "received_at DESC", s.limit ?? 100, s.offset ?? 0);
  return { ...r, range };
}

export interface PurchaseSearch extends SearchBase {
  supplierId?: string;
  status?: string | string[];
}

export async function searchPurchaseOrders(s: PurchaseSearch = {}): Promise<SearchResult<PurchaseOrder>> {
  await ensureStore();
  const range = periodRange(s.period, s.from, s.to);
  const where: string[] = ["1=1"];
  const args: (string | number)[] = [];
  if (range.from) { where.push("delivery_date >= ?"); args.push(range.from); }
  if (range.to) { where.push("delivery_date <= ?"); args.push(range.to); }
  if (s.supplierId) { where.push("supplier_id = ?"); args.push(s.supplierId); }
  const statuses = s.status ? [s.status].flat() : [];
  if (statuses.length) { where.push(`status IN (${statuses.map(() => "?").join(",")})`); args.push(...statuses); }
  if (s.q) { where.push("json LIKE ?"); args.push(`%${s.q}%`); }
  const r = page<PurchaseOrder>(where.join(" AND "), args, "purchase_orders", "delivery_date DESC, created_at DESC", s.limit ?? 200, s.offset ?? 0);
  return { ...r, range };
}

/** URL の検索パラメータ → 検索条件（/api/search/* と画面の両方で使う） */
export function paramsToSearch(p: URLSearchParams) {
  const list = (k: string) => {
    const v = p.get(k);
    return v ? v.split(",").filter(Boolean) : undefined;
  };
  const num = (k: string) => (p.get(k) ? Number(p.get(k)) : undefined);
  return {
    period: (p.get("period") as Period | null) ?? undefined,
    from: p.get("from") ?? undefined,
    to: p.get("to") ?? undefined,
    customerId: p.get("customer") ?? undefined,
    supplierId: p.get("supplier") ?? undefined,
    q: p.get("q") ?? undefined,
    status: list("status"),
    channel: list("channel"),
    intent: (p.get("intent") as OrderSearch["intent"]) ?? undefined,
    dateField: (p.get("dateField") as OrderSearch["dateField"]) ?? undefined,
    limit: num("limit"),
    offset: num("offset"),
  };
}
