// 公開前の名前の付け替え（⑤・案 B）。英語の識別子に残っていた実在の社名を、架空の名前に変えた。
// コードだけ変えると、すでに DB（data/hub.sqlite）に入っている古い名前（マスタの名前・発注方法の値・注文の source.extra など）が
// 見つからなくなるので、DB を開いたときに1回だけ、全部の表の文字の列を新しい名前に書き換える（kv に済みの印）。
// data/channels.json（取り込みの前回値）も同じく書き換える。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

/** 古い名前（実在の社名なので、ソースには base64 で置く。公開するファイルに社名を書かないため）→ 新しい名前 */
const OLD = (b64: string) => Buffer.from(b64, "base64").toString("utf8");
/** 古い名前 → 新しい名前（大文字・先頭大文字・小文字）。架空の仕入先に合わせる（S06 きらら・S07 ふじみ・S03 ひので・S08 こがね） */
export const RENAMES: [string, string][] = (
  [[OLD("bmlzc2hpbg=="), "kirara"], [OLD("c2hpa2lzaGltYQ=="), "fujimi"], [OLD("eWFtYXpha2k="), "hinode"], [OLD("a2lua2E="), "kogane"]] as [string, string][]
).flatMap(([a, b]) => [
  [a.toUpperCase(), b.toUpperCase()],
  [a[0].toUpperCase() + a.slice(1), b[0].toUpperCase() + b.slice(1)],
  [a, b],
]);

export const RENAME_MARK = "rename_real_names_v1";

export const renameText = (s: string) => RENAMES.reduce((t, [a, b]) => t.split(a).join(b), s);

/** DB の全部の表の文字の列を書き換える（済みなら何もしない）。書き換えた行の数を返す */
export function migrateRenamedNames(db: DatabaseSync, dataDir?: string): number {
  db.exec(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL);`);
  if (db.prepare("SELECT 1 FROM kv WHERE key = ?").get(RENAME_MARK)) return 0;
  let changed = 0;
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const t of tables) {
      const cols = (db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string; type: string }[]).filter((c) => /TEXT|^$/i.test(c.type)).map((c) => c.name);
      for (const c of cols) {
        let expr = `"${c}"`;
        for (const [a, b] of RENAMES) expr = `REPLACE(${expr}, '${a}', '${b}')`;
        const like = RENAMES.map(([a]) => `instr("${c}", '${a}') > 0`).join(" OR ");
        const r = db.prepare(`UPDATE "${t}" SET "${c}" = ${expr} WHERE typeof("${c}") = 'text' AND (${like})`).run();
        changed += Number(r.changes);
      }
    }
    db.prepare("INSERT INTO kv (key, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json").run(
      RENAME_MARK,
      JSON.stringify({ changed, renames: RENAMES }),
      new Date().toISOString(),
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  // 取り込みの前回値（DB の外のファイル）
  const ch = path.join(dataDir ?? path.join(process.cwd(), "data"), "channels.json");
  if (existsSync(ch)) {
    const s = readFileSync(ch, "utf8");
    const t = renameText(s);
    if (t !== s) writeFileSync(ch, t);
  }
  return changed;
}
