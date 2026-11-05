import { describe, expect, it } from "vitest";
import { checkLeadTime, leadTimeSummary, orderDeadline } from "../leadtime";
import { DEMO_DATE, demoOrders } from "@/data/demo-orders";
import type { Order } from "@/data/types";

const byId = (id: string) => demoOrders.find((o) => o.id === id)!;
const at = (s: string) => `2026-11-${s}:00+09:00`;
const status = (o: Order, now: string) => Object.fromEntries(checkLeadTime(o, now).map((c) => [c.productId, c.status]));

describe("商品ごとの締め（全社一律ではない）", () => {
  it("自社製造: 既定は納品日の1日前、時刻は得意先マスタの締め（病院 12:00）", () => {
    expect(orderDeadline("P06", "C02", DEMO_DATE).deadline).toBe("2026-11-05T12:00:00+09:00");
  });

  it("商品に時刻があればそれ（食パンは前日の正午）", () => {
    expect(orderDeadline("P03", "C01", DEMO_DATE).deadline).toBe("2026-11-05T12:00:00+09:00");
  });

  it("商品にリードタイムがあればそれ（OEMのピザは3日前、27cm は2日前）", () => {
    expect(orderDeadline("P11", "C12", DEMO_DATE).deadline).toBe("2026-11-03T16:00:00+09:00"); // まるしょう食品の締め 16:00
    expect(orderDeadline("P13", "C10", DEMO_DATE).deadline).toBe("2026-11-04T15:00:00+09:00");
  });

  it("得意先マスタに締めが無ければ 17:00", () => {
    expect(orderDeadline("P01", "CX", DEMO_DATE).deadline).toBe("2026-11-05T17:00:00+09:00");
  });

  it("仕入品: 仕入先の便の締めから出す（ふじみ製パン 前日 11:00）", () => {
    const d = orderDeadline("P10", "C02", DEMO_DATE);
    expect(d.deadline).toBe("2026-11-05T11:00:00+09:00");
    expect(d.basis).toMatch(/仕入先（2便）/);
  });

  it("食パンの包み直し: 元の 3斤 の仕入先の締め", () => {
    expect(orderDeadline("P15", "C02", DEMO_DATE).deadline).toBe("2026-11-05T11:00:00+09:00");
  });
});

describe("checkLeadTime: 行ごとに 間に合う / 間に合わない", () => {
  it("締めの前なら全部 ok", () => {
    const c = checkLeadTime(byId("DO-01"), at("05T10:00"));
    expect(c.every((x) => x.status === "ok")).toBe(true);
    expect(c[0].reason).toMatch(/締めは 11\/5 11:00/);
  });

  it("11:30 なら 仕入品と包み直しは late、自社製造（12:00締め）はまだ ok", () => {
    expect(status(byId("DO-01"), at("05T11:30"))).toEqual({ P10: "late", P06: "ok", P05: "ok", P15: "late" });
    const late = checkLeadTime(byId("DO-01"), at("05T11:30")).find((x) => x.productId === "P10")!;
    expect(late.reason).toMatch(/11\/6納品には間に合わない/);
    expect(late.deadline).toBe("2026-11-05T11:00:00+09:00");
  });

  it("仮発注（概数→当日確定）は、締めを過ぎても warn（警告だけ）", () => {
    const c = checkLeadTime(byId("DO-13"), at("05T11:30"));
    expect(c.map((x) => x.status)).toEqual(["warn", "warn"]);
    expect(c[0].reason).toMatch(/仮発注/);
  });

  it("商品が空の行は unknown", () => {
    const o = { ...byId("DO-02"), lines: [{ ...byId("DO-02").lines[0], productId: "" }] };
    expect(checkLeadTime(o, at("05T10:00"))[0].status).toBe("unknown");
  });

  it("注文全体のまとめは、いちばん悪い状態", () => {
    expect(leadTimeSummary(checkLeadTime(byId("DO-01"), at("05T10:00")))).toBe("ok");
    expect(leadTimeSummary(checkLeadTime(byId("DO-01"), at("05T11:30")))).toBe("late");
    expect(leadTimeSummary(checkLeadTime(byId("DO-13"), at("05T11:30")))).toBe("warn");
  });
});

describe("配送曜日", () => {
  it("納品しない曜日なら late（仮発注でも）。理由に納品する曜日を出す", async () => {
    const { deliveryDayProblem } = await import("../leadtime");
    // グループホーム（C05）は 火・木・土。11/6 は金曜
    expect(deliveryDayProblem("C05", "2026-11-06")).toBe("グループホームあおばは金曜日に納品していません（納品する曜日: 火・木・土）");
    expect(deliveryDayProblem("C05", "2026-11-07")).toBeUndefined();
    const o = { ...byId("DO-08"), status: "confirmed" as const };
    expect(checkLeadTime(o, at("05T08:00")).map((c) => c.status)).toEqual(["late"]);
    expect(checkLeadTime({ ...o, status: "provisional" }, at("05T08:00"))[0].status).toBe("late"); // 曜日は仮発注でも受けられない（締めとちがって、あとで数を決めても変わらない）
  });

  it("便の曜日を使う（南コースは月〜金）。曜日の登録が無い得意先は毎日", async () => {
    const { deliveryDayProblem } = await import("../leadtime");
    expect(deliveryDayProblem("C11", "2026-11-07")).toMatch(/土曜日に納品していません/);
    expect(deliveryDayProblem("C99", "2026-11-08")).toBeUndefined();
  });
});
