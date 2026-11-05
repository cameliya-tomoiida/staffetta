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
  for (const t of tableNames()) {
    if (SKIP.has(t) || !safeName(t)) continue;
    tables[t] = db.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[];
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

/** 書き出したJSONを取り込む（入っている表を入れ替え）。表がまだ無いもの（その機能を一度も使っていない）は飛ばす */
export async function importAll(data: unknown, who: string): Promise<ImportReport> {
  const b = data as Backup;
  if (!b || b.app !== "juhacchu-hub" || b.version !== 1 || typeof b.tables !== "object") {
    throw new Error("STAFFETTA（受発注ハブ）のバックアップファイルではありません");
  }
  const db = getDb();
  const existing = new Set(tableNames());
  const report: ImportReport = { tables: [], skipped: [], files: 0 };
  transaction(() => {
    for (const [name, rows] of Object.entries(b.tables)) {
      if (SKIP.has(name) || !safeName(name) || !existing.has(name) || !Array.isArray(rows)) {
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
