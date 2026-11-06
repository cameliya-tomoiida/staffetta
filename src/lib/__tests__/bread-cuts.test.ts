import { describe, expect, it } from "vitest";
import { breadSummary } from "../bread-cuts";

const products = [
  { id: "A", name: "食パン 8枚切", unit: "斤", loafName: "食パン 3斤", cutLabel: "8枚切り", loavesPerUnit: 1 / 3 },
  { id: "B", name: "食パン 4枚切（喫茶）", unit: "斤", loafName: "食パン 3斤", cutLabel: "4枚切り（手切り）", loavesPerUnit: 1 / 3 },
  { id: "C", name: "食パン 2枚食", unit: "袋", loafName: "食パン 3斤", cutLabel: "2枚食", loavesPerUnit: 2 / 30 },
  { id: "D", name: "バターロール", unit: "個" },
];

describe("食パンのまとめ", () => {
  it("もとの食パンごとに、焼く本数（切り上げ）と、切り方ごとの数・何本ぶん", () => {
    const r = breadSummary([{ productId: "A", pieces: 12 }, { productId: "B", pieces: 2 }, { productId: "C", pieces: 260 }, { productId: "D", pieces: 100 }], products);
    expect(r).toHaveLength(1);
    // 12斤 = 4本、2斤 = 0.67本、260袋 × 2枚 = 520枚 = 17.33本 → 合計ちょうど 22本
    expect(r[0]).toMatchObject({ loaf: "食パン 3斤", loaves: 22, exact: 22 });
    expect(r[0].cuts.map((c) => [c.cut, c.units, c.loaves])).toEqual([["2枚食", 260, 17.33], ["8枚切り", 12, 4], ["4枚切り（手切り）", 2, 0.67]]);
  });
});
