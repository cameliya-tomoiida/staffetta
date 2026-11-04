import "server-only";
import { connection } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Db } from "./types";
import { clearFaxInbox, FAX_INBOX_DIR, loadDb, resetToDemo, saveDiff } from "./db/hub-store";
import { DATA_DIR } from "./db/sqlite";

// 保存先は SQLite（src/lib/db/）。ここは今までどおりの読み書きの口（readDb / updateDb）だけを持つ。

export { emptyDb } from "./db/initial";
export { FAX_INBOX_DIR } from "./db/hub-store";

let queue: Promise<unknown> = Promise.resolve();

/** 保存されている全データを読む（中身は SQLite: data/hub.sqlite） */
export async function readDb(): Promise<Db> {
  await connection(); // 毎回その時点のデータを読む（事前生成しない）
  return loadDb();
}

/** 読み→書きを直列化して、同時更新で消えないようにする。変わった行だけ保存する */
export function updateDb<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const before = await loadDb();
    const db = structuredClone(before);
    const result = await fn(db);
    await saveDiff(before, db);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

/**
 * デモを最初の状態に戻す（受信箱の「デモを最初から」ボタン）。npm run demo:reset と同じ状態:
 * 受信箱 F001〜F005・確定済み DO-01〜DO-20・発注書なし・受け取ったFAXのPDFなし・LINEのひも付けなし。
 */
export async function resetDb() {
  await (queue = queue.then(() => resetToDemo()).catch(() => undefined));
  await clearFaxInbox();
  await fs.writeFile(path.join(DATA_DIR, "line.json"), JSON.stringify({ users: {}, outbox: [] }, null, 2), "utf8");
}

/** FaxDoc.file から、サーバー上のPDFファイルの場所を出す */
export function faxFilePath(file: string): string {
  const m = file.match(/^\/api\/fax-file\/([A-Za-z0-9_-]+)$/);
  if (m) return path.join(FAX_INBOX_DIR, `${m[1]}.pdf`);
  if (file.startsWith("/samples/") && !file.includes("..")) return path.join(process.cwd(), "public", file);
  throw new Error(`FAXファイルの場所が不正です: ${file}`);
}
