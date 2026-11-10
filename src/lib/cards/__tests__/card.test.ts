// ⑦(13) 製品カード: アプリが入れる所（製造計画・班と配置・焼成の目安）と、目標から外れたら赤、記入の進み具合、保存と責任者の確認。
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DoughBatchPlan, ScheduleRow } from "@/lib/production";
import { buildCardBase, cardStatus, checkCard, processesOf, staffText, stepsOf, type CardInput } from "../card";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => undefined }));
beforeAll(() => {
  process.env.HUB_DB_PATH = ":memory:";
});

const dough: DoughBatchPlan = {
  key: "DG01", doughId: "DG01", name: "テーブルロール生地", line: "bread", pieces: 300, netKg: 12, lossRate: 0.05, doughKg: 12.6, flourKg: 7, batches: 1, batchKg: 12.6, ingredients: [],
  items: [
    { productId: "P01", name: "テーブルロール", pieces: 200, doughGram: 40 },
    { productId: "P02", name: "ミニロール", pieces: 100, doughGram: 30 },
  ],
};
const schedule: ScheduleRow = {
  key: "DG01", line: "bread", doughId: "DG01", doughName: "テーブルロール生地", pieces: 300, from: "delivery", warnings: [],
  steps: [
    { key: "mix", name: "ミキシング", start: 21 * 60 + 30, end: 21 * 60 + 50, people: 1, prevDay: true },
    { key: "divide", name: "分割", start: 4 * 60, end: 4 * 60 + 40, people: 2, prevDay: false },
    { key: "bake", name: "焼成", start: 6 * 60, end: 6 * 60 + 30, people: 1, prevDay: false },
  ],
};
const shifts = [
  { id: "SH-N", name: "夜班", line: "bread" as const, from: "21:00", to: "05:00", headcount: 3 },
  { id: "SH-M", name: "朝班", line: "bread" as const, from: "05:00", to: "13:00", headcount: 4 },
];
const assignments = [
  { shiftId: "SH-N", line: "bread" as const, stepKey: "mix" as const, people: 1 },
  { shiftId: "SH-N", line: "bread" as const, stepKey: "divide" as const, people: 2 },
  { shiftId: "SH-M", line: "bread" as const, stepKey: "bake" as const, people: 1 },
];
const steps = [
  { id: "s0", doughId: "DG01", seq: 1, key: "weigh" as const, name: "計量", people: 1, setupMinutes: 0, waitMinutes: 0, minutesPerBatch: 0, prevDay: true, ccp: false },
  { id: "s1", doughId: "DG01", seq: 2, key: "mix" as const, name: "ミキシング", people: 1, setupMinutes: 0, waitMinutes: 0, minutesPerBatch: 10, prevDay: true, ccp: false },
  { id: "s2", doughId: "DG01", seq: 3, key: "ferment" as const, name: "1次発酵", people: 0, setupMinutes: 0, waitMinutes: 60, minutesPerBatch: 0, prevDay: true, ccp: false },
  { id: "s3", doughId: "DG01", seq: 4, key: "divide" as const, name: "分割", people: 2, setupMinutes: 0, waitMinutes: 0, minutesPerBatch: 0, prevDay: false, ccp: false },
  { id: "s4", doughId: "DG01", seq: 5, key: "bake" as const, name: "焼成", people: 1, setupMinutes: 0, waitMinutes: 0, minutesPerBatch: 0, prevDay: false, ccp: false },
  { id: "s5", doughId: "DG01", seq: 6, key: "freeze" as const, name: "急速冷凍", people: 0, setupMinutes: 0, waitMinutes: 30, minutesPerBatch: 0, prevDay: false, ccp: false, tempTargetC: -26, tempMinC: -28, tempMaxC: -24 },
];
const doughs = [{ id: "DG01", name: "テーブルロール生地", line: "bread" as const, lossRate: 0.05, kneadTargetC: 26 }];
const products = [
  { id: "P01", name: "テーブルロール", unit: "個", price: 38, kind: "make" as const, active: true, bakeTempC: 200, bakeMinutes: 12 },
  { id: "P02", name: "ミニロール", unit: "個", price: 28, kind: "make" as const, active: true },
];

const base = buildCardBase({ date: "2026-11-06", productionDate: "2026-11-06", dough, schedule, steps, shifts, assignments, doughs, products, yeast: { name: "生イースト", receivedDate: "2026-11-04" } });

describe("アプリが入れる所", () => {
  it("日付・曜日・製品名・注文数・仕込数（ロス込み）・重さ。焼成の目安は商品のマスタから（無ければ空）", () => {
    expect(base.weekday).toBe("金");
    expect(base.items).toEqual([
      { productId: "P01", name: "テーブルロール", gram: 40, orders: 200, prep: 211, bakeTempC: 200, bakeMinutes: 12 },
      { productId: "P02", name: "ミニロール", gram: 30, orders: 100, prep: 106 },
    ]);
  });
  it("目標の捏上温度は生地のマスタから（許す幅の既定 2）。登録が無ければ空", () => {
    expect(base).toMatchObject({ targetKneadC: 26, kneadToleranceC: 2 });
    const none = buildCardBase({ date: "2026-11-06", productionDate: "2026-11-06", dough, schedule, steps, shifts, assignments });
    expect(none.targetKneadC).toBeUndefined();
    expect(checkCard(none, { mixes: [{ kneadTempC: 40 }], items: {} })).toEqual([]);
  });
  it("工程の行: 工程のマスタの順（待つだけの工程は出さない）＋包装・金属検査。予定・配置・温度の基準", () => {
    const pr = base.processes!;
    expect(pr.map((x) => x.key)).toEqual(["weigh", "mix", "divide", "bake", "freeze", "pack", "metal_check"]);
    expect(pr.find((x) => x.key === "mix")).toMatchObject({ name: "ミキシング", plannedStart: "前日 21:30", staffHint: "夜班 1人" });
    expect(pr.find((x) => x.key === "divide")).toMatchObject({ plannedStart: "4:00", plannedEnd: "4:40", staffHint: "夜班 2人" });
    expect(pr.find((x) => x.key === "freeze")?.temp).toEqual({ target: -26, min: -28, max: -24 });
    expect(pr.find((x) => x.key === "metal_check")).toMatchObject({ name: "金属検査", ccp: true });
    expect(staffText("bread", "mix", undefined, shifts, assignments, 1)).toBeUndefined();
  });
  it("前の版で保存したカード（工程の行が無い）も読める。前の版の分割・焼成の時刻は工程に読みかえる", () => {
    const old = { ...base, processes: undefined, planned: { divideStart: "4:00" }, staff: {} };
    expect(processesOf(old).map((x) => x.key)).toEqual(["mix", "divide", "bake", "pack", "metal_check"]);
    expect(stepsOf({ divideStart: "04:05", divideStaff: "見本", items: {} })).toEqual({ divide: { start: "04:05", staff: "見本" } });
  });
});

describe("目標から外れたら赤", () => {
  it("捏上温度 26±2・焼成温度 目安±10・金属検査×・製品数が注文より少ない・賞味期限切れ", () => {
    const v: CardInput = {
      mixes: [{ kneadTempC: 27 }, { kneadTempC: 29 }], yeastExpiry: "2026-11-01",
      items: { P01: { bakeTempC: 215, metal: "ng", packed: 190 }, P02: { bakeTempC: 205, sensory: "ok", packed: 100 } },
    };
    const f = checkCard(base, v).map((p) => p.field);
    expect(f).toEqual(["mixes.1.kneadTempC", "yeastExpiry", "items.P01.bakeTempC", "items.P01.metal", "items.P01.packed"]);
    // 急速冷凍の温度が管理の範囲の外
    expect(checkCard(base, { steps: { freeze: { tempC: -20 } }, items: {} }).map((x) => x.field)).toEqual(["steps.freeze.tempC"]);
    expect(checkCard(base, { mixes: [{ kneadTempC: 27.5 }], items: {} })).toEqual([]);
    // 前の形（1回分だけ）も1回目として見る
    expect(checkCard(base, { kneadTempC: 31, items: {} }).map((p) => p.field)).toEqual(["mixes.0.kneadTempC"]);
    // 0:00 をまたぐ分割はよい。終わりがずっと前ならだめ
    expect(checkCard(base, { divideStart: "23:30", divideEnd: "00:12", items: {} })).toEqual([]);
    expect(checkCard(base, { steps: { bake: { start: "06:30", end: "06:00" } }, items: {} }).map((x) => x.field)).toEqual(["steps.bake.end"]);
  });
});

describe("記入の進み具合", () => {
  it("まだ → 記入中 → 記入済み → 責任者が確認した", () => {
    expect(cardStatus(base, undefined)).toBe("empty");
    expect(cardStatus(base, { roomTempC: 20, items: {} })).toBe("writing");
    const full: CardInput = { mixes: [{ kneadTempC: 26, waterTempC: 10 }], writer: "見本", items: { P01: { packed: 200, metal: "ok" }, P02: { packed: 100, metal: "ok" } } };
    expect(cardStatus(base, full)).toBe("done");
    expect(cardStatus(base, { ...full, approvedBy: "責任者" })).toBe("approved");
  });
});

describe("保存と責任者の確認（見本の製造計画で）", () => {
  it("保存できる → 確認すると直せない → 確認を外すと直せる", async () => {
    const s = await import("../store");
    // 天気は取りに行かない
    const { cards } = await s.loadCards("2026-11-06", { weather: false });
    expect(cards.length).toBeGreaterThan(0);
    const key = cards[0].base.key;
    const pid = cards[0].base.items[0].productId;
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
    const r = await s.saveCardInput("2026-11-06", key, { kneadTempC: 31, approvedBy: "ずる", items: { [pid]: { packed: 1 } } }, "見本");
    expect(r.problems.map((p) => p.field)).toContain("mixes.0.kneadTempC");
    const c1 = await s.loadCard("2026-11-06", key);
    expect(c1?.input).toMatchObject({ kneadTempC: 31 });
    expect(c1?.input?.approvedBy).toBeUndefined(); // 確認は approveCard だけ
    await s.approveCard("2026-11-06", key, "責任者");
    await expect(s.saveCardInput("2026-11-06", key, { items: {} }, "見本")).rejects.toThrow(/確認を外して/);
    await s.approveCard("2026-11-06", key, "");
    await s.saveCardInput("2026-11-06", key, { kneadTempC: 26, items: {} }, "見本");
    expect((await s.loadCard("2026-11-06", key))?.input?.kneadTempC).toBe(26);
    expect(s.cardLog("2026-11-06", key).length).toBe(4);
    vi.unstubAllGlobals();
  });
});
