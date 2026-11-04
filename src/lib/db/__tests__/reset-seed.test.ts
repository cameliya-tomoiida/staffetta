import { describe, expect, it } from "vitest";
import { resetToDemo } from "../hub-store";
import { listMaster, masterNames, upsertMasters } from "../masters";

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
});
