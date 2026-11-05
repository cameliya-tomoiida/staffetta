// アラート（お知らせ）の保存（①。設計: 01_設計/アラート機能_20261105.md）。
// 判定（③の evaluateAlerts・①の仕組みの見張り）が出した「いま出すべきアラート」を受け取り、
//   - 新しいものは「新しい」で足す（同じ dedupeKey は1件だけ）
//   - まだ出ているものは見出し・中身を新しくする（人が付けた状態・担当者・期限はそのまま）
//   - 判定から消えたもの（解消した）は、自動で「済み」にする
//   - 「済み」のものがまた出てきたら、「新しい」に戻す
//   - 「あとで（〜まで）」は、その時刻を過ぎたら「見た」に戻す
//   - 期限を過ぎたら level を1段上げ、上の人（エスカレーション先）にも知らせる印を付ける
// 状態を変えるたびに履歴を残す。
import { ensureTables, getDb, kvGet, kvSet, transaction } from "./sqlite";

export type AlertLevel = "info" | "warn" | "danger";
export type AlertState = "new" | "seen" | "snoozed" | "done";

/** 判定が出す「いま出すべきアラート」 */
export interface AlertCandidate {
  /** 同じアラートを見分けるキー（例: "stock:M01:2026-11-07"）。ここで1件にまとめる */
  dedupeKey: string;
  /** 種類（例: "stock_short"・"system_fax_gap"）。解消の判定は、同じ判定元（source）の中で行う */
  kind: string;
  level: AlertLevel;
  title: string;
  detail?: string;
  /** 次にすること（ボタンの文）。ボタンが1つのとき・LINE の通知の文に使う */
  action?: string;
  /** アプリの中の場所 */
  href?: string;
  /**
   * ボタン（1件に何個か）。href … その画面を開く／ask … 押すと「はい・いいえ」で聞く文（はいで run を実行して結果を出す）／
   * run … 実行の口の名前（⑤などが用意する。例 "po.draft"・"mail.requestDraft"・"alert.accept"）／args … run に渡す値
   */
  actions?: AlertAction[];
  /** 期限（ISO）。過ぎたら level を上げて上の人にも知らせる */
  dueAt?: string;
  /** 最初の担当者（人が変えたら、そちらが優先） */
  assignee?: string;
}

export interface AlertAction {
  label: string;
  href?: string;
  ask?: string;
  run?: string;
  args?: Record<string, string | number | boolean>;
  /** 主なボタン（強い色） */
  primary?: boolean;
}

export interface AlertHistory { at: string; who: string; what: string }

export interface AlertRow extends AlertCandidate {
  source: string;
  state: AlertState;
  /** 判定が出した元の level（期限切れで上げる前） */
  baseLevel: AlertLevel;
  snoozeUntil?: string;
  /** 期限を過ぎて上の人に知らせた（その人の名前） */
  escalatedTo?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  history: AlertHistory[];
}

const SQL = `
CREATE TABLE IF NOT EXISTS alerts (
  dedupe_key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  level TEXT NOT NULL,
  state TEXT NOT NULL,
  assignee TEXT,
  due_at TEXT,
  updated_at TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS alerts_state ON alerts (state, level);
`;
const init = () => ensureTables("alerts", SQL);

const SYSTEM = "システム";
const LEVELS: AlertLevel[] = ["info", "warn", "danger"];
const up = (l: AlertLevel): AlertLevel => LEVELS[Math.min(LEVELS.length - 1, LEVELS.indexOf(l) + 1)];

function put(r: AlertRow) {
  getDb()
    .prepare(`INSERT INTO alerts (dedupe_key, source, kind, level, state, assignee, due_at, updated_at, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(dedupe_key) DO UPDATE SET source = excluded.source, kind = excluded.kind, level = excluded.level, state = excluded.state,
              assignee = excluded.assignee, due_at = excluded.due_at, updated_at = excluded.updated_at, json = excluded.json`)
    .run(r.dedupeKey, r.source, r.kind, r.level, r.state, r.assignee ?? null, r.dueAt ?? null, r.updatedAt, JSON.stringify(r));
}

function getRow(key: string): AlertRow | undefined {
  const row = getDb().prepare("SELECT json FROM alerts WHERE dedupe_key = ?").get(key) as { json: string } | undefined;
  return row ? (JSON.parse(row.json) as AlertRow) : undefined;
}

/** 設定（エスカレーション先＝期限を過ぎたときに知らせる上の人） */
export interface AlertSettings { escalateTo: string }
export const getAlertSettings = (): AlertSettings => ({ escalateTo: "専務 はやし", ...(kvGet<Partial<AlertSettings>>("alert_settings") ?? {}) });
export function setAlertSettings(v: Partial<AlertSettings>, who: string) {
  kvSet("alert_settings", { ...getAlertSettings(), ...v, updatedBy: who, updatedAt: new Date().toISOString() });
}

/**
 * 判定元（source）が出した「いまのアラート」で入れ替える。
 * その判定元のアラートで、今回の一覧に無い・まだ済んでいないものは「済み」（解消）にする。
 * 返り値: 新しく出たもの・また出たもの（通知に使う）
 */
export function syncAlerts(source: string, candidates: AlertCandidate[], now: string): AlertRow[] {
  init();
  const fresh: AlertRow[] = [];
  transaction(() => {
    const seen = new Set<string>();
    for (const c of candidates) {
      if (seen.has(c.dedupeKey)) continue;
      seen.add(c.dedupeKey);
      const cur = getRow(c.dedupeKey);
      if (!cur) {
        const r: AlertRow = { ...c, source, state: "new", baseLevel: c.level, createdAt: now, updatedAt: now, history: [{ at: now, who: SYSTEM, what: "出しました" }] };
        put(r);
        fresh.push(r);
        continue;
      }
      const reopened = cur.state === "done";
      const r: AlertRow = {
        ...cur,
        // 判定が出す中身は新しくする。人が付けた担当者・期限は残す
        kind: c.kind, title: c.title, detail: c.detail, action: c.action, href: c.href, actions: c.actions,
        dueAt: cur.dueAt ?? c.dueAt,
        assignee: cur.assignee ?? c.assignee,
        source,
        baseLevel: c.level,
        level: cur.escalatedTo && !reopened ? up(c.level) : c.level,
        state: reopened ? "new" : cur.state,
        resolvedAt: reopened ? undefined : cur.resolvedAt,
        escalatedTo: reopened ? undefined : cur.escalatedTo,
        updatedAt: now,
        history: reopened ? [...cur.history, { at: now, who: SYSTEM, what: "また出ました" }] : cur.history,
      };
      put(r);
      if (reopened) fresh.push(r);
    }
    // 解消したもの
    const open = getDb().prepare("SELECT json FROM alerts WHERE source = ? AND state != 'done'").all(source) as { json: string }[];
    for (const { json } of open) {
      const r = JSON.parse(json) as AlertRow;
      if (seen.has(r.dedupeKey)) continue;
      put({ ...r, state: "done", resolvedAt: now, updatedAt: now, history: [...r.history, { at: now, who: SYSTEM, what: "解消したので自動で済みにしました" }] });
    }
  });
  return fresh;
}

/**
 * 時間で変わるもの: 「あとで」の時刻が来たら「見た」に戻す。期限を過ぎたら level を上げ、上の人に知らせる印を付ける。
 * 返り値: 今回、期限切れで上げたもの（上の人への通知に使う）
 */
export function tickAlerts(now: string): AlertRow[] {
  init();
  const escalated: AlertRow[] = [];
  const to = getAlertSettings().escalateTo;
  transaction(() => {
    const open = getDb().prepare("SELECT json FROM alerts WHERE state != 'done'").all() as { json: string }[];
    for (const { json } of open) {
      let r = JSON.parse(json) as AlertRow;
      let changed = false;
      if (r.state === "snoozed" && r.snoozeUntil && r.snoozeUntil <= now) {
        r = { ...r, state: "seen", snoozeUntil: undefined, history: [...r.history, { at: now, who: SYSTEM, what: "「あとで」の時刻になったので戻しました" }] };
        changed = true;
      }
      if (r.dueAt && r.dueAt <= now && !r.escalatedTo && r.state !== "snoozed") {
        r = { ...r, level: up(r.baseLevel), escalatedTo: to, history: [...r.history, { at: now, who: SYSTEM, what: `期限を過ぎたので、${to}さんにも知らせます` }] };
        escalated.push(r);
        changed = true;
      }
      if (changed) put({ ...r, updatedAt: now });
    }
  });
  return escalated;
}

/** 人が状態を変える（見た・あとで・済み・担当者・期限） */
export function updateAlert(
  key: string,
  change: { state?: Exclude<AlertState, "snoozed">; snoozeUntil?: string; assignee?: string; dueAt?: string | null; note?: string },
  who: string,
  now: string,
): AlertRow {
  init();
  if (!who?.trim()) throw new Error("誰が変えたか（名前）を選んでください");
  const cur = getRow(key);
  if (!cur) throw new Error("お知らせが見つかりません");
  const what: string[] = [];
  let r: AlertRow = { ...cur };
  if (change.snoozeUntil) {
    if (change.snoozeUntil <= now) throw new Error("「あとで」は、これから先の時刻を選んでください");
    r = { ...r, state: "snoozed", snoozeUntil: change.snoozeUntil };
    what.push(`あとで（${change.snoozeUntil.slice(5, 16).replace("T", " ")} まで）`);
  } else if (change.state) {
    r = { ...r, state: change.state, snoozeUntil: undefined, resolvedAt: change.state === "done" ? now : undefined };
    what.push({ new: "新しいに戻す", seen: "見た", done: "済み" }[change.state]);
  }
  if (change.assignee !== undefined && change.assignee !== cur.assignee) {
    r.assignee = change.assignee || undefined;
    what.push(change.assignee ? `担当を ${change.assignee} に` : "担当を外す");
  }
  if (change.dueAt !== undefined) {
    r.dueAt = change.dueAt ?? undefined;
    r.escalatedTo = undefined;
    r.level = r.baseLevel;
    what.push(change.dueAt ? `期限を ${change.dueAt.slice(5, 16).replace("T", " ")} に` : "期限を外す");
  }
  if (change.note) what.push(`メモ: ${change.note}`);
  r = { ...r, updatedAt: now, history: [...r.history, { at: now, who, what: what.join("・") || "変更なし" }] };
  put(r);
  return r;
}

export interface AlertQuery { states?: AlertState[]; source?: string; assignee?: string; limit?: number }

/** 一覧（新しい・危ない順） */
export function listAlerts(q: AlertQuery = {}): AlertRow[] {
  init();
  const states = q.states ?? ["new", "seen", "snoozed"];
  const rows = (getDb()
    .prepare(`SELECT json FROM alerts WHERE state IN (${states.map(() => "?").join(",")}) ${q.source ? "AND source = ?" : ""} ORDER BY updated_at DESC`)
    .all(...states, ...(q.source ? [q.source] : [])) as { json: string }[]).map((x) => JSON.parse(x.json) as AlertRow);
  const rank = { danger: 0, warn: 1, info: 2 } as const;
  return rows
    .filter((r) => !q.assignee || r.assignee === q.assignee || r.escalatedTo === q.assignee)
    .sort((a, b) => rank[a.level] - rank[b.level] || (a.state === "new" ? 0 : 1) - (b.state === "new" ? 0 : 1) || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, q.limit ?? 200);
}

/** ベル・帯の数 */
export function alertCounts() {
  init();
  const rows = getDb().prepare("SELECT state, level, COUNT(*) AS n FROM alerts WHERE state != 'done' GROUP BY state, level").all() as { state: AlertState; level: AlertLevel; n: number }[];
  const sum = (f: (r: { state: AlertState; level: AlertLevel }) => boolean) => rows.filter(f).reduce((a, r) => a + r.n, 0);
  return {
    open: sum((r) => r.state !== "snoozed"),
    new: sum((r) => r.state === "new"),
    danger: sum((r) => r.level === "danger" && r.state !== "snoozed"),
    snoozed: sum((r) => r.state === "snoozed"),
  };
}
