// マスタの窓口（service.ts）を、①の SQLite（メモリ上）で通しで確かめる。
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
beforeAll(() => {
  process.env.HUB_DB_PATH = ":memory:";
});

const file = (n: string) => new Uint8Array(readFileSync(path.join(process.cwd(), "public", "samples", "masters", n)));

describe("マスタの窓口（SQLite）", () => {
  it("初期値が入り、CSV はプレビューでは保存されず、確定で保存される。記録が残る", async () => {
    const s = await import("../service");
    const before = await s.list("materials");
    expect(before.find((m) => m.id === "M01")?.stock).toBe(60);

    const buf = file("材料マスタ_追加と在庫.csv");
    const p = await s.previewUpload("materials", buf, "材料.csv");
    expect(p.counts).toMatchObject({ add: 3, update: 1, error: 0 });
    expect((await s.list("materials")).length).toBe(before.length); // まだ保存していない

    await expect(s.applyUpload("materials", buf, "材料.csv", "")).rejects.toThrow(/人/);
    await expect(s.applyUpload("materials", buf, "材料.csv", "専務 はやし", "違うハッシュ")).rejects.toThrow(/違います/);
    const r = await s.applyUpload("materials", buf, "材料.csv", "専務 はやし", p.hash);
    expect(r).toEqual({ added: 3, updated: 1 });
    const after = await s.list("materials");
    expect(after.length).toBe(before.length + 3);
    expect(after.find((m) => m.id === "M01")?.stock).toBe(45);
    const h = await s.history("materials", "M01");
    expect(h[0]).toMatchObject({ action: "update", who: "専務 はやし（CSV: 材料.csv）" });
  });

  it("エラーのある CSV は確定できない", async () => {
    const s = await import("../service");
    const buf = file("包材マスタ_エラーあり.csv");
    await expect(s.applyUpload("packaging", buf, "x.csv", "事務 たなか")).rejects.toThrow(/確定できません/);
  });

  it("1件の追加・修正（CSV と同じ検証）、棚卸、使わない／戻す", async () => {
    const s = await import("../service");
    const ng = await s.saveOne("suppliers", undefined, { name: "テスト油（デモ）", method: "FAX" }, "事務 たなか");
    expect(ng.ok).toBe(false);
    const ok = await s.saveOne("suppliers", undefined, { name: "テスト油（デモ）", method: "FAX", fax: "000-1" }, "事務 たなか");
    expect(ok.ok && ok.record.id).toMatch(/^S\d+$/);

    const t = await s.stocktake("packaging", "K07", 3, "課長 こばやし");
    expect(t).toEqual({ before: 6, after: 3 });
    const k07 = (await s.list("packaging")).find((k) => k.id === "K07")!;
    expect(k07).toMatchObject({ stock: 3, stockCountedBy: "課長 こばやし" });

    await s.remove("packaging", "K07", "課長 こばやし");
    expect((await s.list("packaging")).some((k) => k.id === "K07")).toBe(false);
    await s.restore("packaging", "K07", "課長 こばやし");
    expect((await s.list("packaging")).some((k) => k.id === "K07")).toBe(true);
  });

  it("書き出した CSV を読み直すと「変化なし」（往復できる）", async () => {
    const s = await import("../service");
    const out = await s.exportFile("suppliers");
    const p = await s.previewUpload("suppliers", out, "out.csv");
    expect(p.counts.error).toBe(0);
    expect(p.counts.add + p.counts.update).toBe(0);
  });
});
