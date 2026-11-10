import { describe, expect, it } from "vitest";
import { resetToDemo } from "../hub-store";
import { listMaster, masterNames, upsertMasters } from "../masters";
import { listMoves, logStocktake } from "@/lib/stock/store";
import { sampleMasters } from "@/lib/masters/seed";

describe("デモを最初から: マスタの初期値", () => {
  it("③の商品などと④の取引先が入る", async () => {
    await resetToDemo();
    const names = (await masterNames()).map((n) => n.name);
    expect(names).toContain("customers");
    expect((await listMaster("customers")).length).toBeGreaterThan(0);
    expect(names.length).toBeGreaterThan(3);
  });

  it("人が直したマスタはリセットで消さない（空のときだけ入れる）", async () => {
    await resetToDemo();
    const [c] = await listMaster<{ id: string; name: string }>("customers");
    await upsertMasters("customers", [{ ...c, name: "直した名前" }], "テスト");
    await resetToDemo();
    const after = await listMaster<{ id: string; name: string }>("customers");
    expect(after.find((r) => r.id === c.id)?.name).toBe("直した名前");
  });

  it("在庫の数をサンプルの値に戻し、入荷・使用・棚卸の記録を消す（ほかの列は残す）", async () => {
    await resetToDemo();
    const initial = (sampleMasters().packaging as { id: string; stock: number }[]).find((r) => r.id === "K01")!.stock;
    const [k01] = (await listMaster<{ id: string; stock: number; location: string }>("packaging")).filter((r) => r.id === "K01");
    await upsertMasters("packaging", [{ ...k01, stock: initial - 700, location: "直した置き場" }], "テスト");
    logStocktake("packaging", "K01", initial, initial - 700, "テスト");
    expect(listMoves("packaging", "K01").length).toBeGreaterThan(0);

    await resetToDemo();
    const after = (await listMaster<{ id: string; stock: number; location: string }>("packaging")).find((r) => r.id === "K01")!;
    expect(after.stock).toBe(initial);
    expect(after.location).toBe("直した置き場");
    expect(listMoves("packaging", "K01")).toEqual([]);
  });
});
