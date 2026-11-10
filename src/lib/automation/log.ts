import "server-only";
// 自動で決めたことの記録（⑤）。何を・いつ・なぜ自動にしたか／自動にしなかったか。設定画面・帯に出す。
import { nowIso } from "@/lib/clock";
import { ensureTables, getDb, kvGet, kvSet } from "@/lib/db/sqlite";

export type AutoKind = "order_confirm" | "order_change" | "standing" | "po_approve" | "production" | "reply" | "receipt";

export interface AutoLog {
  seq: number;
  at: string;
  kind: AutoKind;
  /** 注文 ID・発注書 ID・製造日など */
  ref: string;
  /** 自動で決めた（done）／人に回した（held） */
  result: "done" | "held";
  message: string;
}

const SQL = `CREATE TABLE IF NOT EXISTS automation_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, result TEXT NOT NULL, message TEXT NOT NULL);`;
const init = () => ensureTables("automation_log", SQL);

export function logAuto(kind: AutoKind, ref: string, result: AutoLog["result"], message: string) {
  init();
  getDb().prepare("INSERT INTO automation_log (at, kind, ref, result, message) VALUES (?, ?, ?, ?, ?)").run(nowIso(), kind, ref, result, message);
}

export function listAutoLog(limit = 100, kind?: AutoKind): AutoLog[] {
  init();
  const rows = getDb()
    .prepare(`SELECT * FROM automation_log ${kind ? "WHERE kind = ?" : ""} ORDER BY seq DESC LIMIT ?`)
    .all(...((kind ? [kind, limit] : [limit]) as (string | number)[])) as Record<string, unknown>[];
  return rows.map((r) => ({ seq: Number(r.seq), at: String(r.at), kind: r.kind as AutoKind, ref: String(r.ref), result: r.result as AutoLog["result"], message: String(r.message) }));
}

/** 決まった時刻の仕事を、同じ区切り（週・日）に1回だけ動かすための印 */
export function ranFor(task: string, period: string): boolean {
  return kvGet<string>(`auto_ran_${task}`) === period;
}
export function markRan(task: string, period: string) {
  kvSet(`auto_ran_${task}`, period);
}

/** 自動で決めた人の名前（confirmedBy・approvedBy などに入れる）。「自動」で始まる */
export const AUTO = (why: string) => `自動（${why}）`;
export const isAuto = (who?: string) => !!who && who.startsWith("自動");
