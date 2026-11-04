// デモ用のサンプル CSV（public/samples/masters/）が、初期データに対して思ったとおりの結果になるか。
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { previewCsv, type RefIndex } from "../csv";
import { materialDef, packagingDef, seedMaterials, seedPackaging, seedSuppliers, supplierDef } from "../defs";

const file = (n: string) => new Uint8Array(readFileSync(path.join(process.cwd(), "public", "samples", "masters", n)));
const sups = seedSuppliers();
const refs: RefIndex = { suppliers: sups.map((s) => ({ id: s.id, name: s.name })) };

describe("マスタのサンプル CSV", () => {
  it("仕入先: 1件更新（締め 15:00→14:00）・2件追加", () => {
    const p = previewCsv(supplierDef, file("仕入先マスタ_追加と変更.csv"), sups, { refs });
    expect(p.counts).toMatchObject({ add: 2, update: 1, error: 0 });
    expect(p.rows[0].kind === "update" && p.rows[0].changes.map((c) => c.column)).toContain("1便 締め");
    expect(p.canApply).toBe(true);
  });

  it("材料: 在庫の更新と、仕入先を名前で書いた新規3件", () => {
    const p = previewCsv(materialDef, file("材料マスタ_追加と在庫.csv"), seedMaterials(), { refs });
    expect(p.counts).toMatchObject({ add: 3, error: 0 });
    expect(p.counts.update).toBe(1);
    expect(p.canApply).toBe(true);
  });

  it("材料: Shift_JIS（Excel で保存した CSV）も読める", () => {
    const p = previewCsv(materialDef, file("材料マスタ_ShiftJIS.csv"), seedMaterials(), { refs });
    expect(p.encoding).toBe("shift_jis");
    expect(p.counts).toMatchObject({ update: 2, error: 0 });
  });

  it("包材: 2件追加・棚卸の更新1件", () => {
    const p = previewCsv(packagingDef, file("包材マスタ_追加.csv"), seedPackaging(), { refs });
    expect(p.counts).toMatchObject({ add: 2, update: 1, error: 0 });
  });

  it("包材: エラーのある行を行番号・列名つきで返し、確定させない", () => {
    const p = previewCsv(packagingDef, file("包材マスタ_エラーあり.csv"), seedPackaging(), { refs });
    expect(p.rows.map((r) => r.kind)).toEqual(["error", "error", "error"]);
    expect(p.canApply).toBe(false);
  });
});
