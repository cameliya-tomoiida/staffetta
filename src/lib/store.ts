import "server-only";
import { connection } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Db, FaxDoc } from "./types";

// デモ用のかんたんな保存先（JSONファイル）。本番ではDBに置き換える。
const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const initialFaxes = (): FaxDoc[] => [
  { id: "F001", file: "/samples/fax1.pdf", receivedAt: "2026-11-05T08:12:00+09:00", label: "発信元: ﾋﾏﾜﾘﾎｲｸｴﾝ", status: "new" },
  { id: "F002", file: "/samples/fax2.pdf", receivedAt: "2026-11-05T08:40:00+09:00", label: "（発信元表示なし）", status: "new" },
  { id: "F003", file: "/samples/fax3.pdf", receivedAt: "2026-11-05T09:47:00+09:00", label: "発信元: ﾐﾅﾄｷｭｳｼｮｸｾﾝﾀｰ", status: "new" },
];

export const emptyDb = (): Db => ({ faxes: initialFaxes(), orders: [], mappings: {} });

let queue: Promise<unknown> = Promise.resolve();

export async function readDb(): Promise<Db> {
  await connection(); // 毎回その時点のデータを読む（事前生成しない）
  try {
    return JSON.parse(await fs.readFile(DB_FILE, "utf8")) as Db;
  } catch {
    return emptyDb();
  }
}

/** 読み→書きを直列化して、同時更新で消えないようにする */
export function updateDb<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const db = await readDb();
    const result = await fn(db);
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), "utf8");
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

export async function resetDb() {
  return updateDb((db) => {
    Object.assign(db, emptyDb());
  });
}
