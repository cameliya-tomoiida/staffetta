import { describe, expect, it } from "vitest";
import { mixerText, planMixers } from "../mixer-plan";

const mixers = [
  { id: "L", name: "ミキサー（大）", maxFlourKg: 50 },
  { id: "M", name: "ミキサー（中）", minFlourKg: 8, maxFlourKg: 25 },
  { id: "S", name: "ミキサー（小）", minFlourKg: 1, maxFlourKg: 7 },
];

describe("仕込みの回数（P1）", () => {
  it("1回で回せるいちばん小さいミキサー。入らなければ大で同じ量ずつ何回か", () => {
    expect(planMixers(5, mixers)).toEqual({ mixerId: "S", mixerName: "ミキサー（小）", batches: 1, flourPerBatch: 5 });
    expect(planMixers(20, mixers)).toMatchObject({ mixerId: "M", batches: 1 });
    expect(planMixers(40, mixers)).toMatchObject({ mixerId: "L", batches: 1, flourPerBatch: 40 });
    expect(planMixers(80, mixers)).toMatchObject({ mixerId: "L", batches: 2, flourPerBatch: 40 });
    expect(mixerText(planMixers(80, mixers)!)).toBe("ミキサー（大） 粉 40kg × 2回");
  });
  it("硬い生地は生地ごとの1回の上限（中でも大でもそれまで）。下限より少ないと小さいミキサーは使わない", () => {
    expect(planMixers(24, mixers, 20)).toMatchObject({ mixerId: "L", batches: 2, flourPerBatch: 12 });
    // 7.5kg は小の上限（7）より多く、中の下限（8）より少ない → 大で1回
    expect(planMixers(7.5, mixers)).toMatchObject({ mixerId: "L", batches: 1 });
    expect(planMixers(0, mixers)).toBeUndefined();
    expect(planMixers(10, [])).toBeUndefined();
  });
});
