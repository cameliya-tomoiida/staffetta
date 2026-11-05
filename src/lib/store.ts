import "server-only";
import { connection } from "next/server";
import path from "node:path";
import type { Db } from "./types";
import { clearFaxInbox, FAX_INBOX_DIR, loadDb, loadRecentDb, resetToDemo, saveDiff, type RecentDb } from "./db/hub-store";
import { todayJst } from "./clock";
import { resetLineDemo } from "./channels/line/state";

// 保存先は SQLite（src/lib/db/）。ここは今までどおりの読み書きの口（readDb / updateDb）だけを持つ。

export { emptyDb } from "./db/initial";
export { FAX_INBOX_DIR } from "./db/hub-store";

let queue: Promise<unknown> = Promise.resolve();

/** 保存されている全データを読む（中身は SQLite: data/hub.sqlite） */
export async function readDb(): Promise<Db> {
  await connection(); // 毎回その時点のデータを読む（事前生成しない）
  return loadDb();
}

/**
 * 画面に出すための「最近の分だけ」（既定: 納品日・受信が60日前より後 ＋ 要確認・仮発注・未確定の FAX・未送信の発注書は全部）。
 * 長く使ってたまっても画面が重くならないように。読むだけで、updateDb には使わない（updateDb は全件を読む）。
 */
export async function readRecentDb(days = 60): Promise<RecentDb> {
  await connection();
  return loadRecentDb({ since: todayJst(-days) });
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
 * 受信箱 F001〜F005・確定済み DO-01〜DO-20・発注書なし・受け取ったFAXのPDFなし・架空のLINEのお客さんなし（本物のLINEのひも付けは残す）。
 */
export async function resetDb() {
  await (queue = queue.then(() => resetToDemo()).catch(() => undefined));
  await clearFaxInbox();
  // LINE は架空のお客さん（U_demo_…）の分だけ消す。本物の LINE のひも付け・送った記録は残す（④）
  await resetLineDemo();
}

/** FaxDoc.file から、サーバー上のPDFファイルの場所を出す */
export function faxFilePath(file: string): string {
  const m = file.match(/^\/api\/fax-file\/([A-Za-z0-9_-]+)$/);
  if (m) return path.join(FAX_INBOX_DIR, `${m[1]}.pdf`);
  if (file.startsWith("/samples/") && !file.includes("..")) return path.join(process.cwd(), "public", file);
  throw new Error(`FAXファイルの場所が不正です: ${file}`);
}
