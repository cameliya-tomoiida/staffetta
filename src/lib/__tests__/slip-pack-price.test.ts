// LINE の注文「5枚入を4袋」＝20枚の伝票の値段（卸価格が1枚あたり → 20 × 120。11/7）
import { describe, expect, it } from "vitest";
import { priceLine } from "../slips/calc";

const book = {
  products: [{ id: "P07", name: "ピザクラスト 23cm", unit: "枚", price: 120, kind: "make" as const }],
  customerProducts: [{ customerId: "C10", productId: "P07", name: "ピザクラスト 23cm", unit: "枚", price: 120, active: true }],
};

describe("priceLine: 袋で頼んで、卸価格が1枚あたり", () => {
  it("金額 = 個数 × 卸価格（入数 × 数 × 単価）", () => {
    const s = priceLine({ productId: "P07", quantity: 4, unit: "袋", piecesPerUnit: 5, pieces: 20 }, "C10", book);
    expect(s).toMatchObject({ quantity: 20, unit: "枚", unitPrice: 120, amount: 2400, priceFrom: "卸価格" });
  });
  it("同じ単位ならそのまま", () => {
    const s = priceLine({ productId: "P07", quantity: 4, unit: "枚", piecesPerUnit: 1, pieces: 4 }, "C10", book);
    expect(s).toMatchObject({ quantity: 4, amount: 480 });
  });
});
