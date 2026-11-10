import { describe, expect, it } from "vitest";
import { suggestAlternatives } from "../alternatives";
import { DEMO_DATE, demoOrders } from "@/data/demo-orders";
import type { Order } from "@/data/types";

const NOW = "2026-11-05T11:30:00+09:00";
const byId = (id: string) => demoOrders.find((o) => o.id === id)!;
const mk = (id: string, customerId: string, date: string, lines: [string, number][]): Order => ({
  ...demoOrders[0], id, customerId, deliveryDate: date, status: "needs_review", intent: "new",
  lines: lines.map(([productId, q], i) => ({ ...demoOrders[0].lines[0], id: `${id}-${i}`, productId, quantity: q, unit: "個", piecesPerUnit: 1, pieces: q, edits: [] })),
});

describe("代わりの日の提案", () => {
  it("問題が無ければ、このまま受けられる", () => {
    const r = suggestAlternatives(byId("DO-02"), "2026-11-04T09:00:00+09:00", { otherOrders: demoOrders });
    expect(r.ok).toBe(true);
    expect(r.message).toBe("11/6(金)のご注文は、このまま受けられます");
    expect(r.lines.every((l) => l.earliestDate === DEMO_DATE)).toBe(true);
  });

  it("締めを過ぎた行: いちばん早く受けられる納品日と、その日の締め", () => {
    // 11/5 11:30 の時点で、病院の超じゅくロール（仕入先の締め 前日 11:00）は 11/6 に間に合わない
    const r = suggestAlternatives(byId("DO-01"), NOW, { otherOrders: demoOrders });
    expect(r.ok).toBe(false);
    const roll = r.lines.find((l) => l.productId === "P10")!;
    expect(roll.problems.map((p) => p.kind)).toEqual(["deadline"]);
    expect(roll).toMatchObject({ earliestDate: "2026-11-07", earliestReason: "11/7(土)なら受けられます（締め 11/6 11:00）" });
    // 自社で作るミニロール（締め 前日 12:00）はまだ間に合う
    expect(r.lines.find((l) => l.productId === "P06")!.problems).toEqual([]);
    expect(r.earliestDateForAll).toBe("2026-11-07");
    expect(r.message).toMatch(/11\/7\(土\)の納品なら、全部受けられます/);
  });

  it("納品しない曜日: 次の納品する曜日", () => {
    // グループホーム（火・木・土）に金曜の注文
    const r = suggestAlternatives(mk("X1", "C05", "2026-11-06", [["P01", 30]]), "2026-11-04T09:00:00+09:00", { otherOrders: demoOrders });
    expect(r.lines[0].problems[0]).toMatchObject({ kind: "weekday" });
    expect(r.lines[0].earliestDate).toBe("2026-11-07");
  });

  it("ラインの上限を超える日: ラインの全部の枚数と比べる", () => {
    // 11/6 はピザが 1,650枚（ライン 1,800）。27cm は 200枚だけなので、27cm の上限 1,200 は超えない（11/5 担当者の答えに合わせた）
    expect(suggestAlternatives(byId("DO-18"), NOW, { otherOrders: demoOrders }).lines.find((l) => l.productId === "P11")!.problems.map((x) => x.kind)).not.toContain("capacity");
    // ほかのピザ 200枚を足すと 1,850枚 → ラインの上限 1,800 を 50枚 超える
    const r = suggestAlternatives(mk("X5", "C12", "2026-11-06", [["P07", 200]]), NOW, { otherOrders: demoOrders });
    expect(r.lines[0].problems.find((x) => x.kind === "capacity")!.reason).toMatch(/ピザラインが 11\/6\(金\) は上限 1,800枚 を 50枚 超えます/);
  });

  it("商品の上限を超える日: その商品の枚数だけと比べ、商品の名前で知らせる", () => {
    // 11/9 は 27cm が 200枚。27cm を 1,100枚足すと 1,300枚 → 27cm の上限 1,200 を 100枚 超える
    const r = suggestAlternatives(mk("X6", "C12", "2026-11-09", [["P13", 1100]]), NOW, { otherOrders: demoOrders });
    expect(r.lines[0].problems.find((x) => x.kind === "capacity")!.reason).toMatch(/ピザクラスト 27cmが 11\/9\(月\) は上限 1,200枚 を 100枚 超えます/);
  });

  it("上限を超える日は、前の日に作っておけるか（冷凍のピザ）", () => {
    // 11/10 はすでに OEM ピザ 800枚（上限 1,500）。そこへ ピザクラスト 1,200枚 → 超える
    const big = mk("X2", "C10", "2026-11-10", [["P07", 1200]]);
    const r = suggestAlternatives(big, NOW, { otherOrders: demoOrders });
    const l = r.lines[0];
    expect(l.problems.map((x) => x.kind)).toEqual(["capacity"]);
    // 11/9 はすでに 800枚で空き 1,000枚 → 足りない。11/8 は空き 1,800枚 → 作っておける
    expect(l.makeEarlier).toMatchObject({ productionDate: "2026-11-08", room: 1800 });
    expect(l.makeEarlier!.reason).toMatch(/11\/8\(日\)に作っておけば、納品日は 11\/10\(火\) のままで受けられます/);
  });

  it("その日に作るパンは、前の日に作る提案をしない", () => {
    const m = mk("X3", "C01", "2026-11-09", [["P01", 50]]);
    const r = suggestAlternatives(m, NOW, { otherOrders: demoOrders });
    expect(r.lines[0].makeEarlier).toBeUndefined();
  });

  it("探す日数の中に無ければ、電話で相談", () => {
    const r = suggestAlternatives(mk("X4", "C05", "2026-11-06", [["P01", 30]]), NOW, { otherOrders: demoOrders, maxDays: 0 });
    expect(r.earliestDateForAll).toBeUndefined();
    expect(r.message).toMatch(/電話で相談/);
  });
});
