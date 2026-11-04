import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.HUB_DB_PATH = ":memory:";
});

describe("hub-store（SQLite）", () => {
  it("デモの状態で始まり、変わった行だけ保存・削除される", async () => {
    const hs = await import("../hub-store");
    const db = await hs.loadDb(); // 初回 = デモの状態
    expect(db.faxes.map((f) => f.id)).toEqual(["F001", "F002", "F003", "F004", "F005"]);
    expect(Object.keys(db.templates).sort()).toEqual(["C01", "C02", "C03"]);
    const n = db.orders.length;
    expect(n).toBeGreaterThan(0);

    const after = structuredClone(db);
    after.faxes[0].status = "review";
    after.orders = after.orders.slice(1);
    after.importedMessageIds.push("m1");
    after.mappings.C01 = { ...after.mappings.C01, テスト品: "P01" };
    after.templates.C09 = { customerId: "C09", title: "新様式", layoutSummary: "x", items: {}, draftedBy: "m", approvedBy: "たなか", approvedAt: "2026-11-05" };
    await hs.saveDiff(db, after);

    const again = await hs.loadDb();
    expect(again.faxes[0].status).toBe("review");
    expect(again.orders).toHaveLength(n - 1);
    expect(again.importedMessageIds).toEqual(["m1"]);
    expect(again.mappings.C01["テスト品"]).toBe("P01");
    expect(again.templates.C09.approvedBy).toBe("たなか");

    await hs.resetToDemo();
    const reset = await hs.loadDb();
    expect(reset.orders).toHaveLength(n);
    expect(reset.templates.C09).toBeUndefined();
    expect(reset.importedMessageIds).toEqual([]);
  });
});
