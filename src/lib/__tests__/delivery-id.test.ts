import { describe, expect, it } from "vitest";
import { runPipeline } from "../pipeline";
import { sampleMasters } from "../masters/seed";
import { DEMO_DATE, demoOrders } from "@/data/demo-orders";
import type { Masters } from "@/data/types";

describe("仕入先の便の ID（DB の行の鍵「仕入先ID|便ID」のまま入っていても）", () => {
  it("同じ便の発注書は1つ。ID がかぶらない", () => {
    const m = sampleMasters();
    // DB から読むと、便の id が「S07|1」のように2列をつないだ形になっていることがある
    const fromDb: Masters = { ...m, supplierDeliveries: m.supplierDeliveries.map((d) => ({ ...d, id: `${d.supplierId}|${d.id}` })) };
    const plain = runPipeline(demoOrders, DEMO_DATE, { masters: m }).productPurchaseOrders;
    const db = runPipeline(demoOrders, DEMO_DATE, { masters: fromDb }).productPurchaseOrders;
    const ids = db.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    // つないだ形でも、ふつうの ID のときと同じ発注書になる
    expect(ids).toEqual(plain.map((p) => p.id));
    expect(db.map((p) => p.lines.map((l) => [l.itemId, l.units]))).toEqual(plain.map((p) => p.lines.map((l) => [l.itemId, l.units])));
    expect(ids.some((id) => id.includes("|"))).toBe(false);
  });
});
