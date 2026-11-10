import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.resetModules();
});

describe("共通の時計（DEMO_NOW）", () => {
  it("DEMO_NOW があれば、その時刻から始まって本物と同じ速さで進む", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-04T23:00:00+09:00") });
    vi.stubEnv("DEMO_NOW", "2026-11-05T11:30:00+09:00");
    const c = await import("../clock");
    expect(c.nowIso()).toBe("2026-11-05T02:30:00.000Z");
    expect(c.todayJst()).toBe("2026-11-05");
    expect(c.todayJst(1)).toBe("2026-11-06");
    expect(c.nowJstIso()).toBe("2026-11-05T11:30:00+09:00");
    expect(c.isDemoClock()).toBe(true);
    vi.advanceTimersByTime(90 * 60_000);
    expect(c.nowJstIso()).toBe("2026-11-05T13:00:00+09:00");
  });

  it("DEMO_NOW が無ければ本物の時計", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-04T23:00:00+09:00") });
    vi.stubEnv("DEMO_NOW", "");
    vi.stubEnv("NEXT_PUBLIC_DEMO_NOW", "");
    const c = await import("../clock");
    expect(c.todayJst()).toBe("2026-11-04");
    expect(c.isDemoClock()).toBe(false);
  });

  it("おかしな値なら本物の時計", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-04T23:00:00+09:00") });
    vi.stubEnv("DEMO_NOW", "あした");
    const c = await import("../clock");
    expect(c.todayJst()).toBe("2026-11-04");
  });
});
