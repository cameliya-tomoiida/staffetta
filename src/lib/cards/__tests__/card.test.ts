// ⑦(13) 製品カード: アプリが入れる所（製造計画・班と配置・焼成の目安）と、目標から外れたら赤、記入の進み具合、保存と責任者の確認。
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DoughBatchPlan, ScheduleRow } from "@/lib/production";
import { buildCardBase, cardStatus, checkCard, parseBakeGuide, staffText, type CardInput } from "../card";

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
const steps = [{ id: "s1", doughId: "DG01", seq: 9, key: "bake" as const, name: "焼成", people: 1, setupMinutes: 0, waitMinutes: 0, minutesPerBatch: 0, prevDay: false, ccp: false, note: "上火200℃ 12分" }];

const base = buildCardBase({ date: "2026-11-06", productionDate: "2026-11-06", dough, schedule, steps, shifts, assignments, yeast: { name: "生イースト", receivedDate: "2026-11-04" } });

describe("アプリが入れる所", () => {
  it("日付・曜日・製品名・注文数・仕込数（ロス込み）・重さ", () => {
    expect(base.weekday).toBe("金");
    expect(base.items).toEqual([
      { productId: "P01", name: "テーブルロール", gram: 40, orders: 200, prep: 211 },
      { productId: "P02", name: "ミニロール", gram: 30, orders: 100, prep: 106 },
    ]);
    expect(base.targetKneadC).toBe(26);
  });
  it("工程表の予定（前日の作業は「前日」）と、その時刻の班の配置", () => {
    expect(base.planned).toMatchObject({ mix: "前日 21:30", divideStart: "4:00", divideEnd: "4:40", bakeStart: "6:00" });
    expect(base.staff).toMatchObject({ mix: "夜班 1人", divide: "夜班 2人", bake: "朝班 1人" });
    expect(staffText("bread", "mix", undefined, shifts, assignments, 1)).toBeUndefined();
  });
  it("焼成の目安は工程のメモから読む", () => {
    expect(base.bakeGuide).toEqual({ text: "上火200℃ 12分", tempC: 200, minutes: 12 });
    expect(parseBakeGuide("")).toBeUndefined();
    expect(parseBakeGuide("ふつうに焼く")).toEqual({ text: "ふつうに焼く" });
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
    expect(checkCard(base, { mixes: [{ kneadTempC: 27.5 }], items: {} })).toEqual([]);
    // 前の形（1回分だけ）も1回目として見る
    expect(checkCard(base, { kneadTempC: 31, items: {} }).map((p) => p.field)).toEqual(["mixes.0.kneadTempC"]);
    // 0:00 をまたぐ分割はよい。終わりがずっと前ならだめ
    expect(checkCard(base, { divideStart: "23:30", divideEnd: "00:12", items: {} })).toEqual([]);
    expect(checkCard(base, { bakeStart: "06:30", bakeEnd: "06:00", items: {} }).map((x) => x.field)).toEqual(["bakeEnd"]);
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
