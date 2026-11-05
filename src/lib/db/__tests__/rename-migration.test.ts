// 公開前の名前の付け替え（⑤）: 古い DB に入っている古い名前を、DB を開いたときに1回だけ新しい名前に書き換える。
// 古い名前は実在の社名なので、テストにも直接は書かない（RENAMES から作る）。
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { migrateRenamedNames, RENAMES, renameText } from "../rename-migration";

const oldOf = (now: string) => RENAMES.find(([, b]) => b === now)![0];

describe("名前の付け替えの移行", () => {
  it("全部の表の文字の列（マスタの名前・JSON の中の発注方法・注文の印）を書き換え、2回目は何もしない", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE masters (name TEXT, id TEXT, json TEXT, disabled INTEGER, PRIMARY KEY (name, id));
             CREATE TABLE orders (id TEXT PRIMARY KEY, json TEXT);`);
    const items = `${oldOf("kirara")}_items`;
    const site = `${oldOf("fujimi")}_site`;
    db.prepare("INSERT INTO masters VALUES (?, ?, ?, 0)").run(items, "910001", JSON.stringify({ id: "910001", dest: `${oldOf("fujimi")}_main` }));
    db.prepare("INSERT INTO masters VALUES (?, ?, ?, 0)").run("suppliers", "S07", JSON.stringify({ id: "S07", method: site }));
    db.prepare("INSERT INTO masters VALUES (?, ?, ?, 0)").run("suppliers", "S01", JSON.stringify({ id: "S01", method: "fax" }));
    db.prepare("INSERT INTO orders VALUES (?, ?)").run("NS-1", JSON.stringify({ source: { extra: { site: oldOf("kirara") } }, note: oldOf("KOGANE") }));

    const dir = mkdtempSync(path.join(os.tmpdir(), "rename-"));
    writeFileSync(path.join(dir, "channels.json"), JSON.stringify({ [`${oldOf("kirara")}:2026-11-08`]: { totals: {} } }));

    const n = migrateRenamedNames(db, dir);
    expect(n).toBe(4); // 列ごとに数える（masters の name・json×2、orders の json）
    expect(db.prepare("SELECT name FROM masters WHERE id = '910001'").get()).toEqual({ name: "kirara_items" });
    expect(JSON.parse((db.prepare("SELECT json FROM masters WHERE id = '910001'").get() as { json: string }).json).dest).toBe("fujimi_main");
    expect(JSON.parse((db.prepare("SELECT json FROM masters WHERE id = 'S07'").get() as { json: string }).json).method).toBe("fujimi_site");
    expect(JSON.parse((db.prepare("SELECT json FROM orders").get() as { json: string }).json)).toEqual({ source: { extra: { site: "kirara" } }, note: "KOGANE" });
    expect(readFileSync(path.join(dir, "channels.json"), "utf8")).toContain("kirara:2026-11-08");

    // 2回目は何もしない（済みの印）
    db.prepare("INSERT INTO masters VALUES (?, ?, ?, 0)").run("suppliers", "S99", JSON.stringify({ method: site }));
    expect(migrateRenamedNames(db, dir)).toBe(0);
  });

  it("大文字・先頭大文字・小文字の3つの形を書き換える", () => {
    const [lower] = RENAMES.filter(([, b]) => b === "hinode").map(([a]) => a);
    const cap = lower[0].toUpperCase() + lower.slice(1);
    expect(renameText(`${lower.toUpperCase()} ${cap} ${lower}`)).toBe("HINODE Hinode hinode");
  });
});
