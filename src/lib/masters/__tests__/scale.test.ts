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
  it("1日に生地が 10〜15 種類。ライ麦・湯種の食パンも入る。1つの生地から何種類も", () => {
    const kinds = new Set(r.production.doughs.map((d) => d.doughId));
    expect(kinds.size).toBeGreaterThanOrEqual(10);
    expect(kinds.size).toBeLessThanOrEqual(15);
    const many = r.production.doughs.filter((d) => new Set(d.items.map((i) => i.productId)).size >= 3);
    expect(many.length).toBeGreaterThanOrEqual(3);
    const names = r.production.doughs.map((d) => d.name);
    expect(names).toContain("ライ麦食パン生地");
    expect(names).toContain("湯種食パン生地");
  });

  it("ピザ生地は 5回くらい仕込む・食パン生地も 5回くらい回す", () => {
    const pizza = r.production.doughs.filter((d) => d.doughId === "DG04").reduce((s, d) => s + d.batches, 0);
    const bread = r.production.doughs.filter((d) => d.doughId === "DG03").reduce((s, d) => s + d.batches, 0);
    expect(pizza).toBeGreaterThanOrEqual(5);
    expect(bread).toBeGreaterThanOrEqual(5);
  });

  it("工程表は全部の生地に行があり、作る順番（決まり）も全部を1回ずつ並べる", () => {
    expect(r.schedule.length).toBe(r.production.doughs.length);
    const facts = orderFacts(r);
    const order = ruleOrder(facts);
    expect(new Set(order.map((s) => s.key)).size).toBe(facts.length);
    for (const s of order) expect(s.reason).not.toMatch(/コース/);
  });

  it("多めに作る: ふつう 2%・バンズ 5%（注文 300 → 作る 315）", () => {
    const items = r.production.doughs.flatMap((d) => d.items);
    const buns = items.filter((i) => i.productId === "P62");
    expect(buns.reduce((s, i) => s + (i.ordered ?? 0), 0)).toBe(300);
    expect(buns.reduce((s, i) => s + i.pieces, 0)).toBeGreaterThanOrEqual(315);
    const roll = items.find((i) => i.productId === "P63")!;
    expect(roll.pieces).toBeGreaterThan(roll.ordered!);
  });

  it("ふつうの日は注意が0件（動画で「全部できます」と見せる画面）", () => {
    expect(r.schedule.flatMap((s) => s.warnings)).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("デモの日は足りない材料が 0〜2件（お知らせが少ない、きれいな状態）", async () => {
    const { materialShortList } = await import("@/lib/material-shortlist");
    const n = materialShortList(r, m).length;
    expect(n).toBeLessThanOrEqual(2);
  });

  it("見本のマスタは変えない（足すだけ）", () => {
    const base = sampleMasters();
    expect(m.doughs.length).toBe(base.doughs.length + 9);
    expect(base.doughs.find((d) => d.id === "DG11")).toBeUndefined();
  });
});
