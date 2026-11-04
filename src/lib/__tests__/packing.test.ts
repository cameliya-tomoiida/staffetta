import { describe, expect, it } from "vitest";
import { bestPack, packFor, packLabel, slicePlan } from "../packing";

describe("入数変換", () => {
  it("病院65個 → 6個入×11袋・余り1", () => {
    const r = packFor(65, 6);
    expect(r.packs).toBe(11);
    expect(r.surplus).toBe(1);
    expect(r.packsFloor).toBe(10);
    expect(r.shortage).toBe(5);
    expect(packLabel(r)).toBe("6個入 × 11袋（余り1）");
  });

  it("割り切れるときは余りも不足も0", () => {
    expect(packFor(48, 8)).toMatchObject({ packs: 6, surplus: 0, shortage: 0 });
  });

  it("7個入・8個入でも計算できる", () => {
    expect(packFor(50, 7)).toMatchObject({ packs: 8, surplus: 6 });
    expect(packFor(50, 8)).toMatchObject({ packs: 7, surplus: 6 });
  });

  it("候補が複数なら余りが少ない入数を選ぶ", () => {
    expect(bestPack(48, [6, 8])).toMatchObject({ packSize: 8, packs: 6, surplus: 0 }); // 同じ余り0なら袋が少ない方
    expect(bestPack(20, [6, 8])).toMatchObject({ packSize: 8, packs: 3, surplus: 4 }); // 余り同じ → 袋が少ない8個入
    expect(bestPack(26, [6, 8])).toMatchObject({ packSize: 6, packs: 5, surplus: 4 });
    expect(bestPack(30, [7, 8])).toMatchObject({ packSize: 8, surplus: 2 });
  });

  it("0個なら0袋", () => {
    expect(packFor(0, 6)).toMatchObject({ packs: 0, surplus: 0 });
  });

  it("入数が0以下ならエラー", () => {
    expect(() => packFor(10, 0)).toThrow();
  });
});

describe("食パンの包み直し（3斤=30枚）", () => {
  it("1枚入り40包 + 2枚入り25包 = 90枚 → 3本ちょうど", () => {
    expect(slicePlan([{ slicesPerPack: 1, packs: 40 }, { slicesPerPack: 2, packs: 25 }], 30)).toEqual({
      slices: 90, slicesPerItem: 30, items: 3, surplusSlices: 0,
    });
  });

  it("31枚なら2本・余り29枚", () => {
    expect(slicePlan([{ slicesPerPack: 1, packs: 31 }], 30)).toMatchObject({ items: 2, surplusSlices: 29 });
  });
});
