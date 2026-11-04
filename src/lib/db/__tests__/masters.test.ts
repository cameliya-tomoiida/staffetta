import { describe, expect, it, beforeAll } from "vitest";

beforeAll(() => {
  process.env.HUB_DB_PATH = ":memory:";
});

describe("masters", () => {
  it("追加・更新・論理削除・戻す・記録が残る", async () => {
    const m = await import("../masters");
    await m.upsertMasters("products", [{ id: "P01", name: "バターロール", price: 38 }], "テスト");
    await m.upsertMasters("products", [{ id: "P01", name: "バターロール", price: 40 }], "テスト");
    await m.upsertMasters("products", [{ id: "P01", name: "バターロール", price: 40 }], "テスト"); // 変わらない→記録しない
    expect((await m.getMaster<{ id: string; price: number }>("products", "P01"))?.price).toBe(40);
    await m.deleteMaster("products", "P01", "テスト");
    expect(await m.listMaster("products")).toHaveLength(0);
    expect(await m.listMaster("products", { includeDisabled: true })).toHaveLength(1);
    await m.restoreMaster("products", "P01", "テスト");
    expect(await m.listMaster("products")).toHaveLength(1);
    const h = await m.getMasterHistory("products", "P01");
    expect(h.map((x) => x.action)).toEqual(["restore", "disable", "update", "insert"]);
    expect(await m.seedMastersIfEmpty("products", [{ id: "X" }])).toBe(false);
    expect(await m.seedMastersIfEmpty("suppliers", [{ id: "S01" }])).toBe(true);
  });
});
