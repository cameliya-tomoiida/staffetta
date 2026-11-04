// テスト用: store.ts（data/db.json）の代わりに、メモリの中に Db を持つ。
// 使い方: vi.mock("@/lib/store", () => import("./memdb"));
import type { Db } from "@/lib/types";

export const mem: { db: Db; channel: Record<string, unknown> } = { db: blank(), channel: {} };

function blank(): Db {
  return { faxes: [], orders: [], importedMessageIds: [], purchaseOrders: [], templates: {}, mappings: {} };
}

export function resetMem() {
  mem.db = blank();
  mem.channel = {};
}

export async function readDb(): Promise<Db> {
  return structuredClone(mem.db);
}

export async function updateDb<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  const db = structuredClone(mem.db);
  const r = await fn(db);
  mem.db = db;
  return r;
}

export const FAX_INBOX_DIR = "";
