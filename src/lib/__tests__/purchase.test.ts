import { describe, expect, it } from "vitest";
import { totalsForDate } from "../aggregate";
import { addDays, approveDraft, buildProductPurchaseOrders, cutoffIso } from "../purchase";
import { DEMO_DATE, demoOrders } from "@/data/demo-orders";

const drafts = () => buildProductPurchaseOrders(totalsForDate(demoOrders, DEMO_DATE));
const s07 = (deliveryId: string) => drafts().find((d) => d.supplierId === "S07" && d.deliveryId === deliveryId)!;

describe("仕入品の発注書（下書き）", () => {
  it("すべて下書き（draft）で作る。承認なしに送らない", () => {
    expect(drafts().every((d) => d.status === "draft" && !d.approvedBy && !d.sentAt)).toBe(true);
  });

  it("仕入先×便ごとに分ける（あさなぎは1便と2便）", () => {
    expect(drafts().map((d) => `${d.supplierId}-${d.deliveryName}`)).toEqual(["S03-通常便", "S07-1便", "S07-2便"]);
  });

  it("病院（2便）の超じゅくロール 65個 → 6個入×11袋・余り1", () => {
    expect(s07("2").lines.find((l) => l.itemId === "P10")).toMatchObject({
      units: 11, unitLabel: "6個入", quantity: 66, needQuantity: 65, surplus: 1,
    });
  });

  it("1便の超じゅくロール: 保育園 18個 → 3袋 ＋ インフォマート 15袋（90個）= 18袋ちょうど", () => {
    const l = s07("1").lines.find((l) => l.itemId === "P10")!;
    expect(l).toMatchObject({ units: 18, surplus: 0 });
    expect(l.customers!.map((c) => [c.customerId, c.packs])).toEqual([["C01", 3], ["C07", 15]]);
  });

  it("入数の候補が複数（6・8個入）: 20個 → 余りが同じ4なので袋の少ない 8個入×3袋", () => {
    expect(s07("1").lines.find((l) => l.itemId === "P18")).toMatchObject({ units: 3, unitLabel: "8個入", surplus: 4 });
  });

  it("食パン 1枚入40包 + 2枚入25包 → 3斤（30枚）を3本", () => {
    expect(s07("1").lines.find((l) => l.itemId === "P17")).toMatchObject({ units: 3, unitLabel: "30枚切" });
  });

  it("ごまバンズ 6P（10個入）→ 6袋ちょうど。たまごサンド 120+6個 → 126個", () => {
    const s03 = drafts().find((d) => d.supplierId === "S03")!;
    expect(s03.lines.find((l) => l.itemId === "P09")).toMatchObject({ units: 6, surplus: 0 });
    expect(s03.lines.find((l) => l.itemId === "P08")).toMatchObject({ units: 126, unitLabel: "個" });
  });

  it("得意先ごとに割るか、まとめて割るかを選べる", () => {
    const day = totalsForDate(
      [
        { ...demoOrders[0], id: "A", customerId: "C01", lines: [{ ...demoOrders[0].lines[0], quantity: 4, pieces: 4 }] },
        { ...demoOrders[0], id: "B", customerId: "C03", lines: [{ ...demoOrders[0].lines[0], quantity: 4, pieces: 4 }] },
      ],
      DEMO_DATE,
    );
    // 4個と4個（6個入）: 得意先ごと → 1袋+1袋=2袋、まとめて → 8個で2袋（同じ）。余りは 4
    expect(buildProductPurchaseOrders(day)[0].lines[0]).toMatchObject({ units: 2, surplus: 4 });
    const day2 = { ...day, products: day.products.map((p) => ({ ...p, pieces: 12, customers: [{ customerId: "C01", pieces: 3, orderIds: [] }, { customerId: "C03", pieces: 9, orderIds: [] }] })) };
    expect(buildProductPurchaseOrders(day2)[0].lines[0].units).toBe(3); // 1袋 + 2袋
    expect(buildProductPurchaseOrders(day2, { mode: "total" })[0].lines[0].units).toBe(2); // 12個 → 2袋
  });

  it("便ごとの締めが未設定なら、仕入先マスタ（master.ts）の締めを使う", () => {
    expect(s07("1")).toMatchObject({ cutoffAt: "2026-11-05T11:00:00+09:00", cutoffSet: true, method: "fujimi_site" });
  });

  it("締め時刻が設定済みなら 納品日の leadDays 日前の時刻", () => {
    expect(cutoffIso("2026-11-06", "13:00", 1)).toBe("2026-11-05T13:00:00+09:00");
    expect(cutoffIso("2026-11-01", "15:00", 2)).toBe("2026-10-30T15:00:00+09:00");
    expect(cutoffIso("2026-11-06", undefined, 1)).toBe(""); // 未設定なら空（画面で「締め未設定」と出す）
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    const s03 = drafts().find((d) => d.supplierId === "S03")!;
    expect(s03.cutoffAt).toBe("2026-11-05T13:00:00+09:00"); // master.ts の S03 は 13:00・1日前
  });

  it("承認は人の名前が要る。下書き以外は変えない", () => {
    const d = drafts()[0];
    expect(() => approveDraft(d, " ")).toThrow();
    const a = approveDraft(d, "担当");
    expect(a).toMatchObject({ status: "approved", approvedBy: "担当" });
    expect(d.status).toBe("draft");
    expect(approveDraft({ ...a, status: "sent" as const }, "別の人").approvedBy).toBe("担当");
  });
});
