import { describe, expect, it } from "vitest";
import { generateStandingOrders, mondayOf, standingOrderId, weekdayOf } from "../standing-orders";
import { totalsForDate } from "../aggregate";
import { withMasters } from "../catalog";
import { sampleMasters } from "../masters/seed";
import type { Masters } from "@/data/types";

const AT = "2026-11-05T09:00:00+09:00";
const WEEK = "2026-11-09"; // 月曜

describe("日付", () => {
  it("曜日と週の月曜", () => {
    expect(weekdayOf("2026-11-09")).toBe(1);
    expect(weekdayOf("2026-11-08")).toBe(0);
    expect(mondayOf("2026-11-12")).toBe("2026-11-09");
    expect(mondayOf("2026-11-15")).toBe("2026-11-09"); // 日曜はその週の月曜
  });
});

describe("定期注文から、その週の注文を作る", () => {
  const r = generateStandingOrders(WEEK, { now: AT, who: "こばやし" });

  it("得意先 × 納品日で1件。すべて要確認（確定は人）", () => {
    // グループホーム（C05）は 火・木・土、喫茶店（C04）は 月〜土
    expect(r.orders.filter((o) => o.customerId === "C05").map((o) => o.deliveryDate)).toEqual(["2026-11-10", "2026-11-12", "2026-11-14"]);
    expect(r.orders.filter((o) => o.customerId === "C04")).toHaveLength(6);
    expect(r.orders.every((o) => o.status === "needs_review" && o.intent === "new")).toBe(true);
    expect(r.orders[0].id).toBe(standingOrderId(r.orders[0].customerId, r.orders[0].deliveryDate));
  });

  it("行は定期注文の商品・数量・単位。元の値（read）と、確かめてほしい点を残す", () => {
    const o = r.orders.find((x) => x.id === "SO-C05-2026-11-10")!;
    expect(o.lines.map((l) => [l.productId, l.quantity, l.unit, l.pieces])).toEqual([["P01", 30, "個", 30], ["P03", 2, "斤", 2]]);
    expect(o.lines[0].read!.attention).toMatch(/定期注文/);
    expect(o.source).toMatchObject({ channel: "driver", extra: { standing: true, weekday: 2, createdBy: "こばやし" } });
    expect(o.source.refs[0]).toMatchObject({ kind: "manual", note: "定期注文（毎週火曜日）から作成" });
  });

  it("要確認なので、確定するまで集計には入らない", () => {
    expect(totalsForDate(r.orders, "2026-11-10").products).toEqual([]);
    const confirmed = r.orders.map((o) => ({ ...o, status: "confirmed" as const }));
    expect(totalsForDate(confirmed, "2026-11-10").products.find((p) => p.productId === "P01")!.pieces).toBe(30);
  });

  it("もう作ってある注文は作らない（二重にならない）", () => {
    const again = generateStandingOrders(WEEK, { now: AT, existingOrders: r.orders });
    expect(again.orders).toEqual([]);
    expect(again.existing).toHaveLength(r.orders.length);
  });

  it("週の途中で作るときは、あしたより前の日は作らない（notBefore）", () => {
    // 11/11（水）に押した → 11/12（木）から
    const mid = generateStandingOrders(WEEK, { now: AT, notBefore: "2026-11-12" });
    expect(mid.orders.length).toBeGreaterThan(0);
    expect(mid.orders.every((o) => o.deliveryDate >= "2026-11-12")).toBe(true);
    expect(mid.orders.filter((o) => o.customerId === "C05").map((o) => o.deliveryDate)).toEqual(["2026-11-12", "2026-11-14"]);
  });

  it("得意先・日数をしぼれる", () => {
    const one = generateStandingOrders(WEEK, { now: AT, customerId: "C05", days: 3 });
    expect(one.orders.map((o) => o.deliveryDate)).toEqual(["2026-11-10"]);
  });
});

describe("作らない日", () => {
  const patch = (fn: (m: Masters) => void) => {
    const m = structuredClone(sampleMasters());
    fn(m);
    return m;
  };

  it("得意先・便の配送曜日に無い日は作らず、理由を返す", () => {
    // 喫茶店の定期注文に日曜を足しても、西コースは日曜に走らない
    const m = patch((m) => m.standingOrders.push({ id: "SO-X", customerId: "C04", weekday: 0, productId: "P02", quantity: 5, unit: "個", piecesPerUnit: 1, active: true }));
    const r = withMasters(m, () => generateStandingOrders(WEEK, { now: AT }));
    expect(r.orders.some((o) => o.deliveryDate === "2026-11-15")).toBe(false);
    expect(r.skipped).toContainEqual({ customerId: "C04", date: "2026-11-15", reason: "喫茶こもれびは日曜日に納品していません" });
  });

  it("期間（この日から／この日まで）の外は作らない。使わない行も作らない", () => {
    const m = patch((m) => {
      for (const s of m.standingOrders.filter((s) => s.customerId === "C04")) s.from = "2026-11-12";
      for (const s of m.standingOrders.filter((s) => s.customerId === "C05")) s.active = false;
    });
    const r = withMasters(m, () => generateStandingOrders(WEEK, { now: AT }));
    expect(r.orders.map((o) => o.deliveryDate)).toEqual(["2026-11-12", "2026-11-13", "2026-11-14"]);
  });

  it("商品がマスタに無い行は外して、理由を返す", () => {
    const m = patch((m) => m.standingOrders.push({ id: "SO-Y", customerId: "C05", weekday: 2, productId: "PX", quantity: 1, unit: "個", piecesPerUnit: 1, active: true }));
    const r = withMasters(m, () => generateStandingOrders(WEEK, { now: AT, customerId: "C05" }));
    expect(r.orders.find((o) => o.deliveryDate === "2026-11-10")!.lines).toHaveLength(2);
    expect(r.skipped.some((s) => s.reason.includes("PX"))).toBe(true);
  });
});
