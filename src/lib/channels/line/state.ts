import "server-only";
import { nowIso } from "@/lib/clock";
import { promises as fs } from "node:fs";
import path from "node:path";
import { customers } from "@/data/master";

// LINE担当だけが使う保存先（data/line.json）。注文そのものは store.ts（data/db.json）に入れる。
// ここには「LINEのuserId → 得意先」のひも付けと、LINEで送った文面の記録を置く。

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
  /** live = 本物のLINEに送った / demo = LINE未設定のため記録だけ */
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

const FILE = path.join(process.cwd(), "data", "line.json");
const empty = (): LineState => ({ users: {}, outbox: [], linkLog: [] });

export async function readLineState(): Promise<LineState> {
  try {
    return { ...empty(), ...(JSON.parse(await fs.readFile(FILE, "utf8")) as LineState) };
  } catch {
    return empty();
  }
}

let queue: Promise<unknown> = Promise.resolve();
export function updateLineState<T>(fn: (s: LineState) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const s = await readLineState();
    const result = await fn(s);
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(s, null, 2), "utf8");
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
