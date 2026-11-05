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

  it("PDF は既定で入れない。month は日本時間の受信月で選ぶ", async () => {
    const hs = await import("../hub-store");
    const bk = await import("../backup");
    // 受信箱のフォルダ（data/fax-inbox）は本物なので、テストではファイルを作らない。PDF の選び方（月の判定）だけを確かめる
    await hs.resetToDemo();
    const db = await hs.loadDb();
    const changed = structuredClone(db);
    changed.faxes.push(
      { ...db.faxes[0], id: "BKNOV", receivedAt: "2026-10-31T15:30:00.000Z" }, // 日本時間 11/1 0:30 → 11月
      { ...db.faxes[0], id: "BKOCT", receivedAt: "2026-10-31T14:30:00.000Z" }, // 日本時間 10/31 23:30 → 10月
    );
    await hs.saveDiff(db, changed);
    expect((await bk.exportAll()).files).toBeUndefined();
    expect(bk.pdfNamesOfMonth("2026-11").has("BKNOV.pdf")).toBe(true);
    expect(bk.pdfNamesOfMonth("2026-11").has("BKOCT.pdf")).toBe(false);
    expect(bk.pdfNamesOfMonth("2026-10").has("BKOCT.pdf")).toBe(true);
    await expect(bk.exportAll({ includeFiles: true, month: "2026/11" })).rejects.toThrow();
  });
});
