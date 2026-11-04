// 取り込みの設定のマスタを画面（＝service）で変えると、取り込みが読む値も変わる。
import { describe, expect, it } from "vitest";

describe("取り込みの設定のマスタ", () => {
  it("初期値はコードの値と同じ。マスタで変えると読み込む値が変わる", async () => {
    const s = await import("../service");
    const cs = await import("../channel-settings");

    // 専用サイトのコード表: ミニあんぱんは商品にひも付いていない → マスタで P11 を入れる
    expect((await cs.kiraraItems()).find((i) => i.code === "910050")?.productId).toBe("");
    const r = await s.saveOne("kirara_items", "910050", { productId: "P11" }, "事務 たなか");
    expect(r.ok).toBe(true);
    expect((await cs.kiraraItems()).find((i) => i.code === "910050")?.productId).toBe("P11");

    // インフォマートの列名: 実物の言い方「受注番号」を足す
    expect((await cs.infomartHeaders()).slipNo).not.toContain("受注番号");
    await s.saveOne("infomart_headers", "slipNo", { aliases: "受注番号・伝票番号" }, "事務 たなか");
    expect((await cs.infomartHeaders()).slipNo[0]).toBe("受注番号");

    // シートの列: 新しい列見出しを足す
    await s.saveOne("sheet_columns", undefined, { customerId: "C13", header: "ベーグル（6個入）", productId: "P01", piecesPerUnit: "6", unit: "ケース" }, "事務 たなか");
    expect((await cs.sheetColumnMap("C13"))["ベーグル（6個入）"]).toEqual({ productId: "P01", piecesPerUnit: 6, unit: "ケース" });

    // 商品マスタに無い商品IDは登録できない
    const ng = await s.saveOne("sheet_columns", undefined, { customerId: "C13", header: "x", productId: "P99", piecesPerUnit: "1", unit: "個" }, "事務 たなか");
    expect(ng.ok).toBe(false);
  });
});
