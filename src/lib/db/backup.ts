// バックアップ: 全データを JSON 1ファイルに書き出す／取り込む。
// SQLite の全テーブル（受信FAX・注文・発注書・マスタ・LINEのひも付け…ほかの担当の表も）をそのまま入れる。
// 受信したFAXのPDF（data/fax-inbox/）も base64 で入れられる（files）。既定は入れない（1年で約150MBたまるため）。
// 入れるときは月ごとに分けられる（month: "2026-11" … その月に受信した FAX の PDF だけ）。
//
// 取り込みは「入れ替え」: 書き出しに入っている表は、中身を全部消してから入れ直す（入っていない表はさわらない）。
import { promises as fs } from "node:fs";
import path from "node:path";
import { FAX_INBOX_DIR } from "./hub-store";
import { getDb, kvSet, tableNames, transaction } from "./sqlite";

export interface Backup {
  app: "juhacchu-hub";
  version: 1;
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
  /** 受信したFAXのPDF（ファイル名 → base64） */
  files?: Record<string, string>;
}

const SKIP = new Set(["sqlite_sequence"]);
const safeName = (n: string) => /^[A-Za-z0-9_]+$/.test(n);
/** 表の名前は、いまの DB にある表（sqlite_master）の一覧と照らす（文字でつなぐので、念のため） */
const isTable = (n: string, list: Set<string>) => safeName(n) && list.has(n) && !SKIP.has(n);

// 秘密（バックアップのファイルに入れない。取り込んでも、この機械の値を残す）
// user_session_secret … ログインの印の鍵 / mail_graph … メール送信のトークン / ai_settings.apiKey … AI のキー / staff_members[].passwordHash … パスワードの印
const SECRET_KV = new Set(["user_session_secret", "mail_graph"]);
const SECRET_FIELDS: Record<string, string[]> = { ai_settings: ["apiKey"], staff_members: ["passwordHash"] };

/** kv の1行から秘密を除く（消す行は null） */
function scrubKv(row: Record<string, unknown>): Record<string, unknown> | null {
  const key = String(row.key ?? "");
  if (SECRET_KV.has(key)) return null;
  const fields = SECRET_FIELDS[key];
  if (!fields || typeof row.json !== "string") return row;
  try {
    const v = JSON.parse(row.json) as unknown;
    const strip = (o: unknown) => (o && typeof o === "object" ? Object.fromEntries(Object.entries(o as Record<string, unknown>).filter(([k]) => !fields.includes(k))) : o);
    return { ...row, json: JSON.stringify(Array.isArray(v) ? v.map(strip) : strip(v)) };
  } catch {
    return row;
  }
}

/** 受信日（日本時間）が month（YYYY-MM）の FAX の、PDF のファイル名 */
export function pdfNamesOfMonth(month: string): Set<string> {
  const rows = getDb().prepare("SELECT id, received_at FROM faxes").all() as { id: string; received_at: string }[];
  const jstMonth = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 7);
  return new Set(rows.filter((r) => jstMonth(r.received_at) === month).map((r) => `${r.id}.pdf`));
}

/**
 * 全データを書き出す。PDF は既定で入れない（includeFiles: true で入れる）。
 * month を付けると、その月に受信した FAX の PDF だけを入れる（表は全部入る）。
 */
export async function exportAll(opts: { includeFiles?: boolean; month?: string } = {}): Promise<Backup> {
  if (opts.month !== undefined && !/^\d{4}-\d{2}$/.test(opts.month)) throw new Error("month は 2026-11 のように書いてください");
  const db = getDb();
  const tables: Backup["tables"] = {};
  const list = new Set(tableNames());
  for (const t of list) {
    if (!isTable(t, list)) continue;
    const rows = db.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[];
    tables[t] = t === "kv" ? rows.map(scrubKv).filter((r): r is Record<string, unknown> => !!r) : rows;
  }
  const backup: Backup = { app: "juhacchu-hub", version: 1, exportedAt: new Date().toISOString(), tables };
  if (opts.includeFiles ?? false) {
    backup.files = {};
    const names = await fs.readdir(FAX_INBOX_DIR).catch(() => [] as string[]);
    const inMonth = opts.month ? pdfNamesOfMonth(opts.month) : null;
    for (const n of names.filter((n) => /^[A-Za-z0-9_-]+\.pdf$/.test(n) && (!inMonth || inMonth.has(n)))) {
      backup.files[n] = (await fs.readFile(path.join(FAX_INBOX_DIR, n))).toString("base64");
    }
  }
  return backup;
}

export interface ImportReport {
  tables: { name: string; rows: number }[];
  skipped: string[];
  files: number;
}

function restoreSecret(k: Record<string, unknown>) {
  const db = getDb();
  const key = String(k.key);
  const fields = SECRET_FIELDS[key];
  const cur = db.prepare("SELECT * FROM kv WHERE key = ?").get(key) as Record<string, unknown> | undefined;
  // 鍵・トークン（中身ごと秘密）と、取り込んだ物に無い行は、この機械の行をそのまま戻す
  if (!fields || !cur) {
    db.prepare("INSERT OR REPLACE INTO kv (key, json, updated_at) VALUES (?, ?, ?)").run(key, String(k.json), String(k.updated_at ?? new Date().toISOString()));
    return;
  }
  if (typeof cur.json !== "string" || typeof k.json !== "string") return;
  try {
    const old = JSON.parse(k.json) as unknown;
    const now = JSON.parse(cur.json) as unknown;
    const pick = (o: unknown) => (o && typeof o === "object" ? Object.fromEntries(Object.entries(o as Record<string, unknown>).filter(([f]) => fields.includes(f))) : {});
    const merged = Array.isArray(now)
      ? now.map((x) => ({ ...(x as object), ...pick((old as { id?: string }[]).find?.((o) => o?.id === (x as { id?: string }).id)) }))
      : { ...(now as object), ...pick(old) };
    db.prepare("UPDATE kv SET json = ? WHERE key = ?").run(JSON.stringify(merged), key);
  } catch {
    /* 戻せないときは、取り込んだ値のまま */
  }
}

/** 書き出したJSONを取り込む（入っている表を入れ替え）。表がまだ無いもの（その機能を一度も使っていない）は飛ばす */
export async function importAll(data: unknown, who: string): Promise<ImportReport> {
  const b = data as Backup;
  if (!b || b.app !== "juhacchu-hub" || b.version !== 1 || typeof b.tables !== "object") {
    throw new Error("STAFFETTA（受発注ハブ）のバックアップファイルではありません");
  }
  const db = getDb();
  const existing = new Set(tableNames());
  const report: ImportReport = { tables: [], skipped: [], files: 0 };
  // 取り込む前に、この機械の秘密をとっておく（バックアップには入っていないので、入れ替えで消えないように）
  const kept = existing.has("kv")
    ? (db.prepare(`SELECT * FROM kv WHERE key IN (${[...SECRET_KV, ...Object.keys(SECRET_FIELDS)].map(() => "?").join(",")})`).all(...SECRET_KV, ...Object.keys(SECRET_FIELDS)) as Record<string, unknown>[])
    : [];
  transaction(() => {
    for (const [name, rows] of Object.entries(b.tables)) {
      if (!isTable(name, existing) || !Array.isArray(rows)) {
        report.skipped.push(name);
        continue;
      }
      const cols = (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((c) => c.name);
      db.exec(`DELETE FROM ${name}`);
      for (const r of rows) {
        const keys = Object.keys(r).filter((k) => cols.includes(k));
        if (!keys.length) continue;
        db.prepare(`INSERT INTO ${name} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(
          ...keys.map((k) => r[k] as string | number | null),
        );
      }
      report.tables.push({ name, rows: rows.length });
    }
    // 秘密を戻す: 鍵・トークンはそのまま、AI のキー・パスワードの印は、取り込んだ値に足す
    if (b.tables.kv) for (const k of kept) restoreSecret(k);
  });
  if (b.files) {
    await fs.mkdir(FAX_INBOX_DIR, { recursive: true });
    for (const [n, b64] of Object.entries(b.files)) {
      if (!/^[A-Za-z0-9_-]+\.pdf$/.test(n)) continue;
      await fs.writeFile(path.join(FAX_INBOX_DIR, n), Buffer.from(b64, "base64"));
      report.files++;
    }
  }
  kvSet("last_import", { at: new Date().toISOString(), who, exportedAt: b.exportedAt, report });
  return report;
}
