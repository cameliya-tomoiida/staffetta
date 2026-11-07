import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/sqlite";
import { sampleMasters } from "@/lib/masters/seed";
import { scaleMasters } from "@/lib/masters/scale";
import { toItems } from "../price-change-reader";
import { createPriceChange, decidePrices, getPriceChange, marginLine, priceImpact, setMarginLine } from "../price-change";

const m = scaleMasters(sampleMasters());

describe("材料の値上げ → 原価・粗利", () => {
  it("読めた値段（25kg袋 4,500円 → 4,950円）を、マスタの 1kg の原価に直す。マスタに無い品名は外す", () => {
    const items = toItems(
      {
        isPriceChange: true, supplierName: "米田製粉株式会社（デモ）", effectiveDate: "2026-12-01", reason: "",
        items: [
          { materialId: "M01", writtenName: "パン用強力粉 はるかぜ", packLabel: "25kg", oldPrice: 4500, newPrice: 4950, kgPerPack: 25 },
          { materialId: "", writtenName: "ないもの", packLabel: "1kg", oldPrice: 1, newPrice: 2, kgPerPack: 1 },
        ],
      },
      m,
    );
    expect(items).toEqual([{ materialId: "M01", name: "強力粉", unit: "kg", oldCost: 180, newCost: 198 }]);
  });

  it("強力粉を使う商品の粗利率が下がる。線（10%）を切る食パンは「見直しが必要」が上に", () => {
    const imp = priceImpact([{ materialId: "M01", name: "強力粉", unit: "kg", oldCost: 180, newCost: 198 }], m, 10);
    expect(imp.length).toBeGreaterThan(5);
    for (const p of imp) expect(p.rateAfter).toBeLessThan(p.rateBefore);
    expect(imp[0].belowLine).toBe(true);
    expect(imp.filter((p) => p.belowLine).map((p) => p.productId).sort()).toEqual(["P03", "P04"]);
    // ピザ（タイプ00 の粉）は入らない
    expect(imp.some((p) => p.productId === "P07")).toBe(false);
  });
});

describe("値上げの記録", () => {
  beforeEach(() => getDb().exec("DELETE FROM kv WHERE key IN ('price_changes','margin_line')"));

  it("下書きを作る → 卸価格を決める（同じ値・0 は外す）。線は初期 10%・変えられる", () => {
    const c = createPriceChange({ supplierId: "S01", supplierName: "米田製粉（デモ）", effectiveDate: "2026-12-01", items: [{ materialId: "M01", name: "強力粉", unit: "kg", oldCost: 180, newCost: 198 }] });
    expect(c.status).toBe("draft");
    expect(() => decidePrices(c.id, [{ productId: "P03", name: "食パン 8枚切", oldPrice: 260, newPrice: 260 }], "2026-12-01")).toThrow(/1つ以上/);
    const d = decidePrices(c.id, [{ productId: "P03", name: "食パン 8枚切", oldPrice: 260, newPrice: 275 }, { productId: "P04", name: "食パン 6枚切", oldPrice: 260, newPrice: 0 }], "2026-12-01");
    expect(d.decisions).toEqual([{ productId: "P03", name: "食パン 8枚切", oldPrice: 260, newPrice: 275 }]);
    expect(getPriceChange(c.id)?.priceFrom).toBe("2026-12-01");
    expect(marginLine()).toBe(10);
    setMarginLine(12);
    expect(marginLine()).toBe(12);
    expect(() => setMarginLine(-1)).toThrow();
  });
});
