import { describe, expect, it } from "vitest";
import { aggregateOrders, deliveryDatesOf, linePieces, provisionalForDate, totalsForDate } from "../aggregate";
import { piecesPerUnitFor, toPieces, unitKind } from "../units";
import { DEMO_DATE, demoOrders } from "@/data/demo-orders";
import type { Order } from "@/data/types";

const pieces = (date: string, productId: string) =>
  totalsForDate(demoOrders, date).products.find((p) => p.productId === productId)?.pieces;

describe("単位をそろえる", () => {
  it("単位の書き方を3種類に分ける", () => {
    expect(unitKind("個")).toBe("piece");
    expect(unitKind("枚")).toBe("piece");
    expect(unitKind("P")).toBe("bag");
    expect(unitKind("袋")).toBe("bag");
    expect(unitKind("c/s")).toBe("case");
    expect(unitKind("C/S")).toBe("case");
    expect(unitKind("ケース")).toBe("case");
    expect(unitKind("？")).toBeNull();
  });

  it("商品の入数から 1単位あたりの個数を出す", () => {
    expect(piecesPerUnitFor("P01", "個")).toBe(1);
    expect(piecesPerUnitFor("P01", "P")).toBe(10); // バターロール 10個入
    expect(piecesPerUnitFor("P07", "c/s")).toBe(50); // ピザクラスト 1ケース50枚
    expect(piecesPerUnitFor("P07", "袋")).toBe(5);
  });

  it("書類に書いてある入数を優先する", () => {
    expect(toPieces(3, "P", "P07", 6).pieces).toBe(18);
    expect(toPieces(3, "P", "P07").pieces).toBe(15);
  });

  it("わからない単位は 1個として数え、注意を出す", () => {
    const r = toPieces(4, "かご", "P01");
    expect(r.pieces).toBe(4);
    expect(r.warning).toBeTruthy();
  });
});

describe("集計", () => {
  it("確定の注文だけを数える（要確認・取り消しは入れない）", () => {
    // P01: 病院 12P×10=120 + 給食センター 3c/s×100=300 = 420（要確認の999は入らない）
    expect(pieces(DEMO_DATE, "P01")).toBe(420);
    // P02: 喫茶店30（取り消しの500は入らない）
    expect(pieces(DEMO_DATE, "P02")).toBe(30);
  });

  it("intent=change・cancel の注文は数えない（二重に数えない）", () => {
    // P10: 病院65 + 保育園18。変更FAX（DO-11 の 70個）は入らない
    expect(pieces(DEMO_DATE, "P10")).toBe(83);
    // P05: 保育園 8P×10=80。キャンセルFAX（DO-12）は引き算もしない（人が確定すると元の注文が書き換わる）
    expect(pieces(DEMO_DATE, "P05")).toBe(80);
  });

  it("仮発注は確定の集計に入れず、別枠の合計で返す", () => {
    const prov = provisionalForDate(demoOrders, DEMO_DATE);
    expect(prov.products.map((p) => [p.productId, p.pieces])).toEqual([["P01", 200], ["P10", 30]]);
    expect(prov.products[0].customers[0].orderIds).toEqual(["DO-13"]);
    // 置き換わった古い仮発注（cancelled・supersededBy あり）は入らない
    expect(provisionalForDate(demoOrders, "2026-11-07").products).toEqual([]);
    expect(deliveryDatesOf(demoOrders)).toEqual(["2026-11-06", "2026-11-07"]);
  });

  it("単位が混在していても個数で合計する（個・P・c/s）", () => {
    // P07 ピザクラスト: 4P×5=20 + 12c/s×50=600
    expect(pieces(DEMO_DATE, "P07")).toBe(620);
    // P10: 65個 + 18個
    expect(pieces(DEMO_DATE, "P10")).toBe(83);
  });

  it("得意先ごとの内訳と元の注文IDを残す", () => {
    const t = totalsForDate(demoOrders, DEMO_DATE).products.find((p) => p.productId === "P10")!;
    expect(t.customers).toEqual([
      { customerId: "C02", pieces: 65, orderIds: ["DO-01"] },
      { customerId: "C01", pieces: 18, orderIds: ["DO-02"] },
    ]);
  });

  it("納品日ごとに分ける", () => {
    const days = aggregateOrders(demoOrders);
    expect(days.map((d) => d.date)).toEqual(["2026-11-06", "2026-11-07"]);
    expect(pieces("2026-11-07", "P10")).toBe(60);
    expect(aggregateOrders(demoOrders, { from: "2026-11-07" }).length).toBe(1);
  });

  it("商品が空の行は集計に入れず、注意を出す", () => {
    const o: Order = {
      ...demoOrders[0], id: "X",
      lines: [{ ...demoOrders[0].lines[0], id: "x1", productId: "" }],
    };
    const d = totalsForDate([o], DEMO_DATE);
    expect(d.products).toEqual([]);
    expect(d.warnings[0]).toMatch(/商品が空/);
  });

  it("保存されている個数と 数量×入数 が違えば注意を出す", () => {
    const l = { ...demoOrders[0].lines[0], quantity: 10, piecesPerUnit: 6, pieces: 50 };
    expect(linePieces(l)).toEqual({ pieces: 60, warning: expect.stringMatching(/合いません/) });
  });
});
