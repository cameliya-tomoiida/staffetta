// LINE の注文フォームの入数・単価・金額・分類・送料（担当者 11/7「入数×数×単価が金額」・管理役2「P・袋は1袋あたり」）
import { describe, expect, it } from "vitest";
import { basisOf, categoryOf, lineAmount, packSizeOf, shippingOf } from "../channels/line/liff-price";

describe("liff-price", () => {
  it("単位が 個・枚・なし は1個あたり、P・袋・箱・ケースは1袋あたり（登録があればそちら）", () => {
    expect(basisOf("枚")).toBe("piece");
    expect(basisOf("")).toBe("piece");
    expect(basisOf("P")).toBe("pack");
    expect(basisOf("袋")).toBe("pack");
    expect(basisOf("ケース")).toBe("pack");
    expect(basisOf("P", "piece")).toBe("piece");
  });
  it("入数: 袋の入数 → 名前の「5枚入」「×6」 → 1（cm・g は入数にしない）", () => {
    expect(packSizeOf("バターロール", 6)).toBe(6);
    expect(packSizeOf("ピザクラスト 23cm 5枚入")).toBe(5);
    expect(packSizeOf("ミニロール ×10")).toBe(10);
    expect(packSizeOf("ピザクラスト 23cm")).toBe(1);
    expect(packSizeOf("ピザ生地玉 180g")).toBe(1);
  });
  it("金額: 1個あたりは 入数×数×単価、1袋あたりは 数×単価", () => {
    expect(lineAmount({ price: 120, pack: 5, basis: "piece" }, 4)).toBe(2400);
    expect(lineAmount({ price: 600, pack: 5, basis: "pack" }, 4)).toBe(2400);
    expect(lineAmount({ pack: 5, basis: "piece" }, 4)).toBeUndefined();
  });
  it("分類: 登録 → 名前から", () => {
    expect(categoryOf("何か", "pizza")).toBe("ピザ");
    expect(categoryOf("食パン 8枚切")).toBe("食パン");
    expect(categoryOf("ピザクラスト 23cm")).toBe("ピザ");
    expect(categoryOf("たまごサンドロール")).toBe("菓子・惣菜");
    expect(categoryOf("バターロール")).toBe("ロール");
  });
  it("送料: 無料の金額以上なら 0", () => {
    expect(shippingOf(5000, 800)).toBe(800);
    expect(shippingOf(12000, 800, 10000)).toBe(0);
    expect(shippingOf(5000, undefined)).toBe(0);
  });
});
