// ④ LINE と③の締め（checkLeadTime）: LIFF で締めを過ぎた商品・納品しない曜日を選べない／受付の画面で行ごとに判定を出す。
// 時計は撮影と同じ DEMO_NOW=2026-11-05 11:30。SQLite はメモリ、注文の保存はメモリの Db。
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DEMO_DATE, demoOrders } from "@/data/demo-orders";
import { mem } from "./memdb";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/store", () => import("./memdb"));

beforeAll(async () => {
  process.env.HUB_DB_PATH = ":memory:";
  process.env.DEMO_NOW = "2026-11-05T11:30:00+09:00";
  mem.db.orders = structuredClone(demoOrders);
  const st = await import("@/lib/channels/line/state");
  await st.resetLineDemo(); // U_demo_kotori → C06（西コース。日曜は納品なし）
});

describe("LIFF のお届け日・商品の選べる／選べない", () => {
  it("liffContext の days: 納品しない曜日は閉じ、締めを過ぎた商品は理由つきで出る", async () => {
    const o = await import("@/lib/channels/line/orders");
    const ctx = await o.liffContext("U_demo_kotori");
    const d6 = ctx.days.find((d) => d.ymd === "2026-11-06")!;
    expect(d6.closed).toBeUndefined();
    expect(d6.late.P10).toContain("11/5 11:00 が締め"); // 仕入品（前日 11:00 締め）はもう間に合わない
    expect(d6.late.P07).toBeUndefined(); // 自社製造（前日 18:00）はまだ間に合う
    expect(ctx.days.find((d) => d.ymd === "2026-11-08")!.closed).toBeTruthy(); // 日曜
    expect(ctx.days.find((d) => d.ymd === "2026-11-09")!.late).toEqual({});
  });

  it("createLiffOrder: 締めを過ぎた商品・納品しない曜日は受けない（古い画面から送られたときの守り）", async () => {
    const o = await import("@/lib/channels/line/orders");
    const before = mem.db.orders.length;
    await expect(o.createLiffOrder({ userId: "U_demo_kotori", deliveryDate: "2026-11-06", items: [{ productId: "P10", quantity: 2 }] })).rejects.toThrow(/締め切りを過ぎました/);
    await expect(o.createLiffOrder({ userId: "U_demo_kotori", deliveryDate: "2026-11-08", items: [{ productId: "P07", quantity: 2 }] })).rejects.toThrow(/お届けのない曜日/);
    expect(mem.db.orders.length).toBe(before);
    // 同じ商品でも、間に合う日なら受ける
    const ok = await o.createLiffOrder({ userId: "U_demo_kotori", deliveryDate: "2026-11-09", items: [{ productId: "P10", quantity: 2 }] });
    expect(ok.status).toBe("needs_review");
  });
});

describe("LINE受付の画面: 行ごとの締めの判定", () => {
  it("lineLeadTimes: late は reason をそのまま、間に合う行は ok", async () => {
    const o = await import("@/lib/channels/line/orders");
    const order = structuredClone(demoOrders.find((x) => x.customerId === "C06" && x.deliveryDate === DEMO_DATE)!);
    order.status = "needs_review";
    order.lines = [
      { ...order.lines[0], id: "a", productId: "P07" },
      { ...order.lines[0], id: "b", productId: "P10" },
    ];
    const lead = o.lineLeadTimes(order);
    expect(lead.a.status).toBe("ok");
    expect(lead.b.status).toBe("late");
    expect(lead.b.reason).toMatch(/^超じゅくロール 6個入は 11\/5 11:00 が締めでした/);
    // 仮発注なら警告だけ（薄い黄）
    expect(o.lineLeadTimes({ ...order, status: "provisional" }).b.status).toBe("warn");
  });
});
