import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/sqlite";
import { runPipeline } from "@/lib/pipeline";
import { DEMO_DATE, demoOrders } from "@/data/demo-orders";
import { sampleMasters } from "@/lib/masters/seed";
import { approveProposal, buildProposals, getProposal, planLines, reviseProposal, scheduleShifts } from "../proposals";

const m = sampleMasters();

describe("AI の案", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM kv WHERE key IN ('ai_proposals') OR key LIKE 'home_timetable_adjust:%'");
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("足りない材料 → 仕入先ごとの発注の案（中身は仕入先ごとの品と数）。同じ日の案は作り直さない", () => {
    const r = runPipeline(demoOrders, DEMO_DATE, { masters: m, now: "2026-11-05T23:00:00+09:00" } as never);
    const ps = buildProposals(DEMO_DATE, r, m);
    const p = ps.find((x) => x.kind === "purchase");
    expect(p).toBeDefined();
    if (!p) return;
    expect(p.title).toMatch(/^足りない材料の発注の案：\d+社・\d+品目。よろしいですか？$/);
    expect(planLines(p).every((l) => /：.+（\d+\/\d+ 着）$/.test(l))).toBe(true);
    expect(buildProposals(DEMO_DATE, r, m).find((x) => x.kind === "purchase")!.id).toBe(p.id);
  });

  it("［直す］言葉で直す（AI が使えないときは決まり）→ 名前が出た品を外して「こう直しました」。記録が残る。［OK］で発注書を作って承認", async () => {
    const r = runPipeline(demoOrders, DEMO_DATE, { masters: m });
    const p = buildProposals(DEMO_DATE, r, m).find((x) => x.kind === "purchase");
    expect(p).toBeDefined();
    if (!p) return;
    const first = p.purchase![0];
    const next = await reviseProposal(p.id, `${first.name}は来週でいい`, "たなか");
    expect(next.purchase!.some((x) => x.materialId === first.materialId)).toBe(false);
    expect(next.title).toMatch(/^足りない材料の発注の案：.+こう直しました（.+）。よろしいですか？$/);
    expect(next.rev).toBe(1);
    expect(next.history.some((h) => h.who === "たなか" && h.text === `${first.name}は来週でいい`)).toBe(true);
    expect(next.purchase!.length).toBeGreaterThan(0);
    const ok = await approveProposal(p.id, "たなか");
    expect(ok.href).toBe("/outbound");
    expect(getProposal(p.id)!.status).toBe("done");
    expect(getProposal(p.id)!.history.at(-1)!.what).toMatch(/^OK:/);
    await expect(approveProposal(p.id, "たなか")).rejects.toThrow(/終わって/);
  });

  it("人が足りない帯 → 重なっている生地を、その長さだけ早く始める案", () => {
    const sched = [
      { key: "DG01", doughName: "ロール生地", steps: [{ key: "mix", name: "", start: 100, end: 160, prevDay: false, people: 2 }], staff: [{ from: 120, to: 145, need: 5, have: 3, level: "short" as const }] },
      { key: "DG02", doughName: "黒糖ロール生地", steps: [{ key: "mix", name: "", start: 300, end: 330, prevDay: false, people: 1 }], staff: [] },
    ] as never;
    const s = scheduleShifts(sched);
    expect(s).toEqual([{ key: "DG01", name: "ロール生地", minutes: -30, from: 100, reason: "人が足りない時間（2:00〜2:25）をなくす" }]);
    expect(planLines({ kind: "schedule", schedule: s })[0]).toBe("ロール生地：30分早く始める（1:40 → 1:10）　人が足りない時間（2:00〜2:25）をなくす");
  });
});
