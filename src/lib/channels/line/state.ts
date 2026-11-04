import "server-only";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { customers } from "@/data/master";
import { nowIso } from "@/lib/clock";
import { listMaster, upsertMasters } from "@/lib/db/masters";
import { ensureTables, getDb, transaction } from "@/lib/db/sqlite";

// LINE担当の保存先（①の SQLite）。注文そのものは store.ts に入れる。
// - LINE の人（userId → 取引先のひも付け）: masters の "line_users"（変更は master_history に残る）
// - ひも付け・解除の記録: line_link_log
// - LINE で送った文面の記録: line_outbox
// 以前の data/line.json は、最初に読んだときに1回だけ取り込み、line.json.migrated に名前を変える。

export interface LineUser {
  userId: string;
  /** LINEのプロフィール名（取れたときだけ） */
  displayName?: string;
  /** 初回にお客さんが自分で入れたお店の名前（人がひも付けるときの手がかり） */
  claimedName?: string;
  /** 最初に届いた文章（どのお店か人が見分ける手がかり） */
  firstMessage?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  /** 人が確認してひも付けた得意先 */
  customerId?: string;
  linkedAt?: string;
  linkedBy?: string;
}

export interface OutboxItem {
  at: string;
  to: string; // userId
  via: "reply" | "push";
  text: string;
  /** live = 本物のLINEに送った / demo = LINE未設定・架空のお客さんのため記録だけ */
  mode: "live" | "demo";
  ok: boolean;
  error?: string;
  orderId?: string;
}

/** ひも付け・解除の履歴（だれが・いつ・どのお店に） */
export interface LinkLogItem {
  at: string;
  userId: string;
  action: "link" | "unlink";
  customerId: string;
  who: string;
}

export interface LineState {
  users: Record<string, LineUser>;
  outbox: OutboxItem[];
  linkLog: LinkLogItem[];
}

const USERS = "line_users";
const SQL = `
CREATE TABLE IF NOT EXISTS line_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  to_user TEXT NOT NULL,
  via TEXT NOT NULL,
  text TEXT NOT NULL,
  mode TEXT NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT,
  order_id TEXT
);
CREATE INDEX IF NOT EXISTS line_outbox_by_order ON line_outbox (order_id);
CREATE TABLE IF NOT EXISTS line_link_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  who TEXT NOT NULL
);
`;
const OUTBOX_SHOWN = 300; // 画面に出す件数（記録は全部残る）

type UserRow = LineUser & { id: string };

async function init() {
  ensureTables("line", SQL);
  await migrateFromJson();
}

let migrated = false;
/** 以前の data/line.json を1回だけ取り込む */
async function migrateFromJson() {
  if (migrated) return;
  migrated = true;
  const file = path.join(process.cwd(), "data", "line.json");
  if (!existsSync(file)) return;
  const old = JSON.parse(await fs.readFile(file, "utf8")) as Partial<LineState>;
  const users = Object.values(old.users ?? {});
  if (users.length) await upsertMasters<UserRow>(USERS, users.map((u) => ({ ...u, id: u.userId })), "line.json から移行");
  writeAppends(old.outbox ?? [], old.linkLog ?? []);
  await fs.rename(file, `${file}.migrated`);
}

function writeAppends(outbox: OutboxItem[], linkLog: LinkLogItem[]) {
  if (!outbox.length && !linkLog.length) return;
  const db = getDb();
  const o = db.prepare("INSERT INTO line_outbox (at, to_user, via, text, mode, ok, error, order_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const l = db.prepare("INSERT INTO line_link_log (at, user_id, action, customer_id, who) VALUES (?, ?, ?, ?, ?)");
  transaction(() => {
    for (const m of outbox) o.run(m.at, m.to, m.via, m.text, m.mode, m.ok ? 1 : 0, m.error ?? null, m.orderId ?? null);
    for (const x of linkLog) l.run(x.at, x.userId, x.action, x.customerId, x.who);
  });
}

export async function readLineState(): Promise<LineState> {
  await init();
  const users = Object.fromEntries((await listMaster<UserRow>(USERS)).map(({ id: _id, ...u }) => [u.userId, u as LineUser]));
  const db = getDb();
  const outbox = (
    db.prepare(`SELECT * FROM (SELECT * FROM line_outbox ORDER BY id DESC LIMIT ${OUTBOX_SHOWN}) ORDER BY id`).all() as {
      at: string; to_user: string; via: OutboxItem["via"]; text: string; mode: OutboxItem["mode"]; ok: number; error: string | null; order_id: string | null;
    }[]
  ).map((r) => ({ at: r.at, to: r.to_user, via: r.via, text: r.text, mode: r.mode, ok: Boolean(r.ok), ...(r.error ? { error: r.error } : {}), ...(r.order_id ? { orderId: r.order_id } : {}) }));
  const linkLog = (
    db.prepare("SELECT at, user_id, action, customer_id, who FROM line_link_log ORDER BY id").all() as {
      at: string; user_id: string; action: LinkLogItem["action"]; customer_id: string; who: string;
    }[]
  ).map((r) => ({ at: r.at, userId: r.user_id, action: r.action, customerId: r.customer_id, who: r.who }));
  return { users, outbox, linkLog };
}

let queue: Promise<unknown> = Promise.resolve();
/**
 * 読む → fn で書き換える → 保存（順番待ちで、同時に書いても消えない）。
 * users は変わった人だけ masters に書く（変更の記録が残る）。outbox・linkLog は fn で足した分だけ書き足す。
 */
export function updateLineState<T>(fn: (s: LineState) => T | Promise<T>, who = "LINE（自動）"): Promise<T> {
  const run = queue.then(async () => {
    const s = await readLineState();
    const before = new Map(Object.values(s.users).map((u) => [u.userId, JSON.stringify(u)]));
    const outboxLen = s.outbox.length;
    const logLen = s.linkLog.length;
    const result = await fn(s);
    const changed = Object.values(s.users).filter((u) => before.get(u.userId) !== JSON.stringify(u));
    // undefined の項目は JSON から消す（解除のとき customerId を消すため）
    if (changed.length) await upsertMasters<UserRow>(USERS, changed.map((u) => JSON.parse(JSON.stringify({ ...u, id: u.userId })) as UserRow), who);
    writeAppends(s.outbox.slice(outboxLen), s.linkLog.slice(logLen));
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

/** userId から得意先を決める。マスターの lineUserId → 人がひも付けた結果 の順。分からなければ "" */
export function customerIdForUser(state: LineState, userId: string): string {
  const fromMaster = customers.find((c) => c.lineUserId && c.lineUserId === userId);
  if (fromMaster) return fromMaster.id;
  return state.users[userId]?.customerId ?? "";
}

/** メッセージが来るたびに呼ぶ。はじめての人なら記録する */
export async function touchUser(userId: string, info: { displayName?: string; claimedName?: string; firstMessage?: string } = {}) {
  return updateLineState((s) => {
    const at = nowIso();
    const u = (s.users[userId] ??= { userId, firstSeenAt: at, lastSeenAt: at });
    u.lastSeenAt = at;
    if (info.displayName) u.displayName = info.displayName;
    if (info.claimedName) u.claimedName = info.claimedName;
    if (info.firstMessage && !u.firstMessage) u.firstMessage = info.firstMessage.slice(0, 200);
    return { user: { ...u }, customerId: customerIdForUser(s, userId) };
  });
}

/**
 * 「デモを最初から」で呼ぶ（①の resetDb から）。架空のお客さん（U_demo_… / U-demo-…）の分だけ消す。
 * 本物の LINE の人（ひも付け・送った記録）は残す。消したあと、DEMO_LINE_USERS をひも付けた状態で入れ直す。
 */
export async function resetLineDemo() {
  await init();
  await listMaster(USERS); // masters の表が無ければ作られる（まっさらなデータベースでも動くように）
  const db = getDb();
  const isDemo = (id: string) => /^U[-_]demo[-_]/i.test(id);
  const ids = (sql: string) => (db.prepare(sql).all() as { id: string }[]).map((r) => r.id).filter(isDemo);
  const users = ids(`SELECT id FROM masters WHERE name = '${USERS}'`);
  const outTo = ids("SELECT DISTINCT to_user AS id FROM line_outbox");
  const logUsers = ids("SELECT DISTINCT user_id AS id FROM line_link_log");
  transaction(() => {
    for (const id of users) db.prepare("DELETE FROM masters WHERE name = ? AND id = ?").run(USERS, id);
    for (const id of outTo) db.prepare("DELETE FROM line_outbox WHERE to_user = ?").run(id);
    for (const id of logUsers) db.prepare("DELETE FROM line_link_log WHERE user_id = ?").run(id);
  });
  // 撮影・デモ用: 架空のお客さんを、はじめからひも付けた状態にする（リッチメニューの「前回と同じ」がすぐ出るように）
  const at = nowIso();
  await upsertMasters<UserRow>(
    USERS,
    DEMO_LINE_USERS.map((u) => ({ id: u.userId, userId: u.userId, displayName: u.displayName, firstSeenAt: at, lastSeenAt: at, customerId: u.customerId, linkedAt: at, linkedBy: "デモの初期値" })),
    "デモを最初から",
  );
  const { syncLineUserIds } = await import("./customers");
  for (const u of DEMO_LINE_USERS) await syncLineUserIds(u.userId, u.customerId, "デモを最初から");
}

/** デモを最初からにしたとき、ひも付けた状態で入る架空のお客さん（どのお店か分からない人の場面は U_demo_komorebi などで見せる） */
export const DEMO_LINE_USERS = [{ userId: "U_demo_kotori", displayName: "ことり（デモ）", customerId: "C06" }];
