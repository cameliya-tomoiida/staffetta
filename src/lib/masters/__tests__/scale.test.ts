// 本物の規模（1日に生地 10〜20 種類・ピザ 5回・食パン 5回）でも計画・工程表・作る順番が組めるか
import { describe, expect, it } from "vitest";
import { runPipeline } from "@/lib/pipeline";
import { orderFacts, ruleOrder } from "@/lib/plan-order";
import { DEMO_DATE, demoOrders } from "@/data/demo-orders";
import { sampleMasters } from "../seed";
import { scaleMasters, scaleOrders } from "../scale";

const m = scaleMasters(sampleMasters());
const orders = [...demoOrders, ...scaleOrders(DEMO_DATE, ["C01", "C02", "C03", "C04", "C06", "C07", "C09"])];
const r = runPipeline(orders, DEMO_DATE, { masters: m });

describe("本物の規模の見本", () => {
  it("1日に生地が 10〜20 種類。ライ麦・湯種の食パンも入る", () => {
    const kinds = new Set(r.production.doughs.map((d) => d.doughId));
    expect(kinds.size).toBeGreaterThanOrEqual(10);
    expect(kinds.size).toBeLessThanOrEqual(20);
    const names = r.production.doughs.map((d) => d.name);
    expect(names).toContain("ライ麦食パン生地");
    expect(names).toContain("湯種食パン生地");
  });

  it("ピザ生地は 5回くらい仕込む・食パン生地も 5回くらい回す", () => {
    const pizza = r.production.doughs.filter((d) => d.doughId === "DG04").reduce((s, d) => s + d.batches, 0);
    const bread = r.production.doughs.filter((d) => d.doughId === "DG03").reduce((s, d) => s + d.batches, 0);
    expect(pizza).toBeGreaterThanOrEqual(4);
    expect(bread).toBeGreaterThanOrEqual(4);
  });

  it("工程表は全部の生地に行があり、作る順番（決まり）も全部を1回ずつ並べる", () => {
    expect(r.schedule.length).toBe(r.production.doughs.length);
    const facts = orderFacts(r);
    const order = ruleOrder(facts);
    expect(new Set(order.map((s) => s.key)).size).toBe(facts.length);
    for (const s of order) expect(s.reason).not.toMatch(/コース/);
  });

  it("見本のマスタは変えない（足すだけ）", () => {
    const base = sampleMasters();
    expect(m.doughs.length).toBe(base.doughs.length + 12);
    expect(base.doughs.find((d) => d.id === "DG11")).toBeUndefined();
  });
});
