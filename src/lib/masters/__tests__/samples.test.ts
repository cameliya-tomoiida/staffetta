// デモ用のサンプル CSV（public/samples/masters/）を、③の初期データに対して番号の順に読み込むと、思ったとおりになるか。
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Masters } from "@/data/types";
import { rowId } from "../columns";
import { previewCsv, recordsToApply } from "../csv";
import { MASTER_DEFS } from "../defs";
import { sampleMasters } from "../seed";

const file = (n: string) => new Uint8Array(readFileSync(path.join(process.cwd(), "public", "samples", "masters", n)));
type Rec = Record<string, unknown> & { id: string };

describe("マスタのサンプル CSV（01〜06 を順に）", () => {
  it("仕入先 → 便 → 材料 → 包材 の順に読むと、エラー無しで入る。エラーありのファイルは止まる", () => {
    const m = sampleMasters() as unknown as Record<string, Rec[]>;
    for (const [name, def] of Object.entries(MASTER_DEFS)) m[name] = (m[name] ?? []).map((r) => ({ ...r, id: rowId(def, r) }));
    const load = (name: keyof Masters, f: string) => {
      const p = previewCsv(MASTER_DEFS[name], file(f), m[name], m as unknown as Partial<Masters>, { fileName: f });
      if (p.canApply) {
        const rows = recordsToApply(p);
        const by = new Map(m[name].map((r) => [r.id, r]));
        for (const r of rows) by.set(r.id, r);
        m[name] = [...by.values()];
      }
      return p;
    };
    const sup = load("suppliers", "01_仕入先マスタ.csv");
    expect(sup.counts).toMatchObject({ add: 10, update: 1, error: 0 });
    expect(sup.rows[0].kind === "update" && sup.rows[0].changes.map((c) => c.column)).toContain("締め時刻");

    const del = load("supplierDeliveries", "02_仕入先の便.csv");
    expect(del.counts.error).toBe(0);
    expect(del.counts.add + del.counts.update).toBeGreaterThan(0);

    const mat = load("materials", "03_材料マスタ.csv");
    expect(mat.counts).toMatchObject({ add: 15, update: 1, error: 0 });

    const pk = load("packaging", "04_包材マスタ.csv");
    expect(pk.counts).toMatchObject({ add: 13, update: 1, error: 0 });

    const sj = load("materials", "05_材料の在庫_ShiftJIS.csv");
    expect(sj.encoding).toBe("shift_jis");
    expect(sj.counts).toMatchObject({ error: 0 });
    expect(sj.counts.update).toBeGreaterThan(0);

    const ng = load("packaging", "06_包材マスタ_エラーあり.csv");
    expect(ng.rows.map((r) => r.kind)).toEqual(["error", "error", "error"]);
    expect(ng.canApply).toBe(false);
  });

  it("商品・取引先・設備のサンプルも③の列名で読める（参照の確認なし）", () => {
    const m = sampleMasters() as unknown as Record<string, Rec[]>;
    for (const [name, f] of [["products", "07_商品マスタ.csv"], ["customers", "08_取引先マスタ.csv"], ["equipment", "09_設備マスタ.csv"]] as const) {
      const p = previewCsv(MASTER_DEFS[name], file(f), [], m as unknown as Partial<Masters>);
      const errs = p.rows.flatMap((r) => (r.kind === "error" ? r.errors.map((e) => `${r.line}行 ${e.column}: ${e.message}`) : []));
      expect(errs, `${f}`).toEqual([]);
      expect(p.counts.add).toBe(p.rows.length);
    }
  });
});
