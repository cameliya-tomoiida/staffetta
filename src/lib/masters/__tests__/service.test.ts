// マスタの窓口（service.ts）を、①の SQLite（メモリ上。vitest.config の HUB_DB_PATH）で通しで確かめる。
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const file = (n: string) => new Uint8Array(readFileSync(path.join(process.cwd(), "public", "samples", "masters", n)));

describe("マスタの窓口（SQLite）", () => {
  it("③のサンプルが入り、CSV はプレビューでは保存されず、確定で保存される。記録が残る", async () => {
    const s = await import("../service");
    const before = await s.list("suppliers");
    expect(before.find((r) => r.id === "S01")?.cutoff).toBe("15:00");

    const buf = file("01_仕入先マスタ.csv");
    const p = await s.previewUpload("suppliers", buf, "仕入先.csv");
    expect(p.counts).toMatchObject({ add: 10, update: 1, error: 0 });
    expect((await s.list("suppliers")).length).toBe(before.length); // まだ保存していない

    await expect(s.applyUpload("suppliers", buf, "仕入先.csv", "")).rejects.toThrow(/人/);
    await expect(s.applyUpload("suppliers", buf, "仕入先.csv", "はやし", "違うハッシュ")).rejects.toThrow(/違います/);
    expect(await s.applyUpload("suppliers", buf, "仕入先.csv", "はやし", p.hash)).toEqual({ added: 10, updated: 1 });
    expect((await s.list("suppliers")).find((r) => r.id === "S01")?.cutoff).toBe("12:00");
    const h = await s.history("suppliers", "S01");
    expect(h[0]).toMatchObject({ action: "update", who: "はやし（CSV: 仕入先.csv）" });

    // 参照（材料 → 仕入先）が、入れたばかりの仕入先でも通る
    const mat = await s.previewUpload("materials", file("03_材料マスタ.csv"), "材料.csv");
    expect(mat.counts.error).toBe(0);
  });

  it("エラーのある CSV は確定できない", async () => {
    const s = await import("../service");
    await expect(s.applyUpload("packaging", file("06_包材マスタ_エラーあり.csv"), "x.csv", "たなか")).rejects.toThrow(/確定できません/);
  });

  it("1件の追加（ID は自動）・修正、棚卸、使わない／戻す", async () => {
    const s = await import("../service");
    const ng = await s.saveOne("suppliers", undefined, { name: "テスト油（デモ）" }, "たなか");
    expect(ng.ok).toBe(false); // 発注方法が必須
    const ok = await s.saveOne("suppliers", undefined, { name: "テスト油（デモ）", method: "FAX", contact: "FAX 000-1" }, "たなか");
    expect(ok.ok && ok.record.id).toMatch(/^S\d+$/);
    const fix = await s.saveOne("suppliers", "S01", { leadDays: "2" }, "たなか");
    expect(fix.ok && fix.record).toMatchObject({ id: "S01", leadDays: 2, name: "米田製粉（デモ）" });

    const t = await s.stocktake("packaging", "K01", 1500, "こばやし");
    expect(t.after).toBe(1500);
    expect((await s.list("packaging")).find((k) => k.id === "K01")).toMatchObject({ stock: 1500, stockCountedBy: "こばやし" });
    await expect(s.stocktake("suppliers", "S01", 1, "こばやし")).rejects.toThrow(/材料・包材/);

    await s.remove("packaging", "K01", "こばやし");
    expect((await s.list("packaging")).some((k) => k.id === "K01")).toBe(false);
    await s.restore("packaging", "K01", "こばやし");
    expect((await s.list("packaging")).some((k) => k.id === "K01")).toBe(true);
  });

  it("書き出した CSV を読み直すと「変化なし」（往復できる）", async () => {
    const s = await import("../service");
    const p = await s.previewUpload("materials", await s.exportFile("materials"), "out.csv");
    expect(p.counts.error).toBe(0);
    expect(p.counts.add + p.counts.update).toBe(0);
  });
});
