// マスタ（商品・生地・工程・取引先・仕入先・材料・包材・設備・人員・注文方法・FAX様式…）の共通の保存の口。
// 行は id を主キーにした JSON をそのまま入れる。項目が増えても表を作り直さなくてよい。
// 変更はすべて master_history に残す（誰が・いつ・何を）。削除は論理削除（disabled: true）。
//
//   listMaster<T>(name, { includeDisabled? })   一覧（既定は無効を除く）
//   getMaster<T>(name, id)                      1件
//   upsertMasters<T>(name, rows, who)           追加・更新（1回の呼び出し＝1トランザクション）
//   deleteMaster(name, id, who)                 論理削除
//   restoreMaster(name, id, who)                論理削除を戻す
//   getMasterHistory(name, id?)                 変更の記録（新しい順）
//   seedMastersIfEmpty(name, rows)              その name が空のときだけ初期値を入れる（③の seed 用）
import { ensureTables, getDb, transaction } from "./sqlite";

const SQL = `
CREATE TABLE IF NOT EXISTS masters (
  name TEXT NOT NULL,
  id TEXT NOT NULL,
  json TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (name, id)
);
CREATE TABLE IF NOT EXISTS master_history (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  id TEXT NOT NULL,
  action TEXT NOT NULL,            -- insert | update | disable | restore
  before_json TEXT,
  after_json TEXT,
  at TEXT NOT NULL,
  who TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS master_history_by_row ON master_history (name, id, seq);
`;

const init = () => ensureTables("masters", SQL);
const nowIso = () => new Date().toISOString();

export interface HistoryRow {
  seq: number;
  name: string;
  id: string;
  action: "insert" | "update" | "disable" | "restore";
  before: unknown;
  after: unknown;
  at: string;
  who: string;
}

type Row = { id: string };

export async function listMaster<T extends Row>(name: string, opts: { includeDisabled?: boolean } = {}): Promise<T[]> {
  init();
  const rows = getDb()
    .prepare(`SELECT json, disabled FROM masters WHERE name = ? ${opts.includeDisabled ? "" : "AND disabled = 0"} ORDER BY id`)
    .all(name) as { json: string; disabled: number }[];
  return rows.map((r) => ({ ...(JSON.parse(r.json) as T), ...(r.disabled ? { disabled: true } : {}) }));
}

export async function getMaster<T extends Row>(name: string, id: string): Promise<T | undefined> {
  init();
  const r = getDb().prepare("SELECT json, disabled FROM masters WHERE name = ? AND id = ?").get(name, id) as { json: string; disabled: number } | undefined;
  return r ? { ...(JSON.parse(r.json) as T), ...(r.disabled ? { disabled: true } : {}) } : undefined;
}

export async function upsertMasters<T extends Row>(name: string, rows: T[], who: string): Promise<void> {
  init();
  if (!who) throw new Error("誰が変えたか（who）が必要です");
  for (const r of rows) if (!r?.id) throw new Error(`${name}: id の無い行があります`);
  const db = getDb();
  const sel = db.prepare("SELECT json, disabled FROM masters WHERE name = ? AND id = ?");
  const up = db.prepare(
    `INSERT INTO masters (name, id, json, disabled, updated_at, updated_by) VALUES (?, ?, ?, 0, ?, ?)
     ON CONFLICT(name, id) DO UPDATE SET json = excluded.json, disabled = 0, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  );
  const hist = db.prepare("INSERT INTO master_history (name, id, action, before_json, after_json, at, who) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const at = nowIso();
  transaction(() => {
    for (const r of rows) {
      // disabled は列で持つので JSON には入れない
      const { disabled: _d, ...rest } = r as T & { disabled?: boolean };
      const json = JSON.stringify(rest);
      const before = sel.get(name, r.id) as { json: string; disabled: number } | undefined;
      if (before && before.json === json && !before.disabled) continue; // 変わっていない
      up.run(name, r.id, json, at, who);
      hist.run(name, r.id, before ? (before.disabled ? "restore" : "update") : "insert", before?.json ?? null, json, at, who);
    }
  });
}

export async function deleteMaster(name: string, id: string, who: string): Promise<void> {
  init();
  const db = getDb();
  transaction(() => {
    const before = db.prepare("SELECT json, disabled FROM masters WHERE name = ? AND id = ?").get(name, id) as { json: string; disabled: number } | undefined;
    if (!before || before.disabled) return;
    const at = nowIso();
    db.prepare("UPDATE masters SET disabled = 1, updated_at = ?, updated_by = ? WHERE name = ? AND id = ?").run(at, who, name, id);
    db.prepare("INSERT INTO master_history (name, id, action, before_json, after_json, at, who) VALUES (?, ?, 'disable', ?, NULL, ?, ?)").run(name, id, before.json, at, who);
  });
}

export async function restoreMaster(name: string, id: string, who: string): Promise<void> {
  init();
  const db = getDb();
  transaction(() => {
    const before = db.prepare("SELECT json, disabled FROM masters WHERE name = ? AND id = ?").get(name, id) as { json: string; disabled: number } | undefined;
    if (!before || !before.disabled) return;
    const at = nowIso();
    db.prepare("UPDATE masters SET disabled = 0, updated_at = ?, updated_by = ? WHERE name = ? AND id = ?").run(at, who, name, id);
    db.prepare("INSERT INTO master_history (name, id, action, before_json, after_json, at, who) VALUES (?, ?, 'restore', NULL, ?, ?, ?)").run(name, id, before.json, at, who);
  });
}

export async function getMasterHistory(name: string, id?: string): Promise<HistoryRow[]> {
  init();
  const rows = (id
    ? getDb().prepare("SELECT * FROM master_history WHERE name = ? AND id = ? ORDER BY seq DESC").all(name, id)
    : getDb().prepare("SELECT * FROM master_history WHERE name = ? ORDER BY seq DESC LIMIT 500").all(name)) as {
    seq: number; name: string; id: string; action: HistoryRow["action"]; before_json: string | null; after_json: string | null; at: string; who: string;
  }[];
  return rows.map((r) => ({
    seq: r.seq, name: r.name, id: r.id, action: r.action, at: r.at, who: r.who,
    before: r.before_json ? JSON.parse(r.before_json) : null,
    after: r.after_json ? JSON.parse(r.after_json) : null,
  }));
}

/** その name の行が1つも無いときだけ、初期値（サンプル）を入れる。入れたら true */
export async function seedMastersIfEmpty<T extends Row>(name: string, rows: T[]): Promise<boolean> {
  init();
  const n = (getDb().prepare("SELECT COUNT(*) AS n FROM masters WHERE name = ?").get(name) as { n: number }).n;
  if (n > 0) return false;
  await upsertMasters(name, rows, "サンプル（初期値）");
  return true;
}

/** すべての name（管理画面の一覧用） */
export async function masterNames(): Promise<{ name: string; count: number }[]> {
  init();
  return getDb().prepare("SELECT name, COUNT(*) AS count FROM masters WHERE disabled = 0 GROUP BY name ORDER BY name").all() as { name: string; count: number }[];
}
