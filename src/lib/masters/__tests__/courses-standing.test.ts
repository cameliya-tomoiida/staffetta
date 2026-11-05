// 便・取引先の納品曜日・定期注文を CSV で入れ、「今週分を作る」で要確認の注文ができるか。マスタは SQLite（メモリ）、注文はメモリの store。
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { mem } from "@/lib/channels/__tests__/memdb";

vi.mock("@/lib/store", () => import("@/lib/channels/__tests__/memdb"));

const file = (n: string) => new Uint8Array(readFileSync(path.join(process.cwd(), "public", "samples", "masters", n)));
const WHO = "事務 たなか";

describe("便・納品曜日・定期注文", () => {
  it("サンプル CSV 10〜12 が順に入る（取引先は2列だけでも、ほかの列は今のまま）", async () => {
    const s = await import("../service");
    const load = async (name: Parameters<typeof s.previewUpload>[0], f: string) => {
      const p = await s.previewUpload(name, file(f), f);
      const errs = p.rows.flatMap((r) => (r.kind === "error" ? r.errors.map((e) => `${r.line} ${e.column} ${e.message}`) : []));
      expect(errs, f).toEqual([]);
      await s.applyUpload(name, file(f), f, WHO, p.hash);
      return p.counts;
    };
    expect(await load("courses", "10_便マスタ.csv")).toMatchObject({ add: 1, update: 1 });
    const before = (await s.list("customers")).find((c) => c.id === "C07");
    expect(await load("customers", "11_取引先の納品曜日.csv")).toMatchObject({ update: 2, add: 0 });
    const after = (await s.list("customers")).find((c) => c.id === "C07");
    expect(after).toMatchObject({ ...before, deliveryWeekdays: [1, 3, 5] });
    expect(await load("standingOrders", "12_定期注文.csv")).toMatchObject({ add: 4 });
    expect((await s.list("courses")).find((c) => c.id === "東コース（朝便）")).toMatchObject({ departTime: "06:50", loadMinutes: 40 });
  });

  it("画面から1件足すと、ID は 得意先-曜日-商品", async () => {
    const s = await import("../service");
    const r = await s.saveOne("standingOrders", undefined, { customerId: "C07", weekday: "水", productId: "P02", quantity: "10" }, WHO);
    expect(r.ok && r.record.id).toBe("SO-C07-3-P02");
  });

  it("今週分を作る: 要確認で入り、2回押しても二重にならない。納品しない曜日は理由つきで作らない", async () => {
    const { createStandingOrdersForWeek } = await import("../standing");
    const s = await import("../service");
    // C07 は 月水金 だけ納品。火曜の行を足すと、作らずに理由が出る
    await s.saveOne("standingOrders", undefined, { customerId: "C07", weekday: "火", productId: "P01", quantity: "5" }, WHO);
    const r = await createStandingOrdersForWeek({ who: WHO, customerId: "C07", weekOf: "2026-11-11" });
    expect(r.weekStart).toBe("2026-11-09");
    expect(r.created.map((c) => c.deliveryDate)).toEqual(["2026-11-09", "2026-11-11", "2026-11-13"]);
    expect(r.created.find((c) => c.deliveryDate === "2026-11-11")?.lines).toBe(2); // P01 と画面で足した P02
    expect(r.skipped.some((x) => x.date === "2026-11-10" && /火曜日に納品していません/.test(x.reason))).toBe(true);
    expect(mem.db.orders.filter((o) => o.id.startsWith("SO-C07-")).every((o) => o.status === "needs_review")).toBe(true);

    const again = await createStandingOrdersForWeek({ who: WHO, customerId: "C07", weekOf: "2026-11-11" });
    expect(again.created).toEqual([]);
    expect(again.existing).toHaveLength(3);
    expect(mem.db.orders.filter((o) => o.id.startsWith("SO-C07-"))).toHaveLength(3);
    await expect(createStandingOrdersForWeek({ who: "", weekOf: "2026-11-11" })).rejects.toThrow(/人/);
  });
});
