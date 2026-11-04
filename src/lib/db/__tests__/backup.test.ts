import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.HUB_DB_PATH = ":memory:";
});

describe("backup", () => {
  it("書き出して、消して、取り込むと元に戻る", async () => {
    const hs = await import("../hub-store");
    const bk = await import("../backup");
    const m = await import("../masters");
    const before = await hs.loadDb();
    await m.upsertMasters("products", [{ id: "P99", name: "テスト品" }], "テスト");
    const data = await bk.exportAll({ includeFiles: false });
    expect(data.tables.orders.length).toBe(before.orders.length);

    const changed = structuredClone(before);
    changed.orders = [];
    await hs.saveDiff(before, changed);
    await m.deleteMaster("products", "P99", "テスト");
    expect((await hs.loadDb()).orders).toHaveLength(0);

    const report = await bk.importAll(JSON.parse(JSON.stringify(data)), "テスト");
    expect(report.tables.find((t) => t.name === "orders")?.rows).toBe(before.orders.length);
    expect((await hs.loadDb()).orders).toHaveLength(before.orders.length);
    expect((await m.getMaster<{ id: string; disabled?: boolean }>("products", "P99"))?.disabled).toBeUndefined();
    await expect(bk.importAll({ app: "other" }, "x")).rejects.toThrow();
  });
});
