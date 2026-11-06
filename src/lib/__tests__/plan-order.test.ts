import { beforeEach, describe, expect, it } from "vitest";
import { approvePlanOrder, getPlanOrder, orderFacts, proposePlanOrder, ruleOrder } from "../plan-order";
import { runPipeline } from "../pipeline";
import { demoOrders, DEMO_DATE } from "@/data/demo-orders";
import { sampleMasters } from "../masters/seed";
import { getDb } from "../db/sqlite";

describe("作る順番の案（P2）", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM kv WHERE key LIKE 'plan_order_%' OR key = 'ai_settings'");
  });
  const r = runPipeline(demoOrders, DEMO_DATE, { masters: sampleMasters() });

  it("決まりの順番は、工程表のミキシングの始まる順。理由に時刻と締め", () => {
    const facts = orderFacts(r);
    const rule = ruleOrder(facts);
    expect(rule).toHaveLength(r.schedule.length);
    const starts = rule.map((s) => facts.find((f) => f.key === s.key)!.mixStartMin);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    expect(rule[0].reason).toMatch(/ミキシングを始める/);
  });

  it("AI が使えないときは決まりの順番で下書き。人が順番を直して OK したものだけ approved", async () => {
    const env = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const p = await proposePlanOrder(DEMO_DATE, r);
    expect(p).toMatchObject({ by: "決まり", status: "draft" });
    const keys = [...p.steps.map((s) => s.key)].reverse();
    expect(() => approvePlanOrder(DEMO_DATE, keys, "")).toThrow(/OK する人/);
    expect(() => approvePlanOrder(DEMO_DATE, keys.slice(1), "もりた")).toThrow(/足りません/);
    const ok = approvePlanOrder(DEMO_DATE, keys, "もりた");
    expect(ok).toMatchObject({ status: "approved", approvedBy: "もりた" });
    expect(getPlanOrder(DEMO_DATE)!.steps.map((s) => s.key)).toEqual(keys);
    if (env) process.env.ANTHROPIC_API_KEY = env;
  });
});
