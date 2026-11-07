// ④ LINE のトークの返事（担当者 11/7「テストと送ったら『受け付けました（確認中）』が返ってきて変」・管理役2）:
// 読み取りのあとに返事を決める。注文 → 読んだ品と数・お届け日。注文ではない（テスト・ありがとう）→ 案内の1通、注文として保存しない・お知らせに1件。
// Claude の読み取り（readLineText）は見本に差し替える。デモの人なので本番の LINE には送らない。
import { beforeAll, describe, expect, it, vi } from "vitest";
import { demoOrders } from "@/data/demo-orders";
import type { LineRead } from "@/lib/channels/line/reader";
import { mem } from "./memdb";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/store", () => import("./memdb"));

let nextRead: () => LineRead;
vi.mock("@/lib/channels/line/reader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/channels/line/reader")>()),
  readLineText: async () => ({ read: nextRead(), model: "mock" }),
}));

const USER = "U_demo_kotori";

beforeAll(async () => {
  process.env.HUB_DB_PATH = ":memory:";
  process.env.DEMO_NOW = "2026-11-05T11:30:00+09:00";
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("本番の LINE に送ろうとしました");
  }));
  (await import("@/lib/channels/line/auto")).setLineAutoSettings({ autoConfirm: false }, "試験");
  mem.db.orders = structuredClone(demoOrders);
  await (await import("@/lib/channels/line/state")).resetLineDemo();
});

describe("トークの返事", () => {
  it.each(["テスト", "ありがとうございました"])("注文ではない「%s」→ 案内の1通・注文は作らない・お知らせに1件", async (text) => {
    const o = await import("@/lib/channels/line/orders");
    const { listAlerts } = await import("@/lib/db/alerts-store");
    nextRead = () => ({ is_order: false, notes: "", orders: [] });
    const before = mem.db.orders.length;
    const r = await o.ingestTalkMessage({ messageId: `t-${text}`, userId: USER, text, receivedAt: "2026-11-05T02:30:00.000Z" });
    expect(mem.db.orders.length).toBe(before);
    const reply = o.talkReplyText(r, "052-000-0000");
    expect(reply).toContain("メッセージありがとうございます");
    expect(reply).toContain("パンを注文する");
    expect(reply).toContain("052-000-0000");
    expect(reply).not.toContain("受け付けました");
    expect(listAlerts({ source: "line_message" }).some((a) => a.title.includes(`「${text}」`))).toBe(true);
  });

  it("注文「明日カレーパン80個」→ 読んだ品と数・お届け日を返す", async () => {
    const o = await import("@/lib/channels/line/orders");
    nextRead = () => ({
      is_order: true,
      notes: "",
      orders: [{ intent: "new", change_of_order_id: "", delivery_date: "2026-11-06", date_written: "明日", lines: [{ written_name: "カレーパン", product_id: "", quantity: 80, unit_written: "個", pieces_per_unit: 1, confidence: 0.6, attention: "" }] }],
    });
    const r = await o.ingestTalkMessage({ messageId: "t-curry", userId: USER, text: "明日カレーパン80個", receivedAt: "2026-11-05T02:30:00.000Z" });
    expect(r.orders?.length).toBe(1);
    const reply = o.talkReplyText(r, "052-000-0000");
    expect(reply).toContain("ご注文を受け付けました");
    expect(reply).toContain("11/6(金) お届け");
    expect(reply).toContain("・カレーパン 80個");
  });

  it("読み取りに失敗・時間切れは今までの短い返事", async () => {
    const o = await import("@/lib/channels/line/orders");
    expect(o.talkReplyText("timeout", "")).toBe("受け付けました（確認中）。");
    expect(o.talkReplyText("error", "")).toBe("受け付けました（確認中）。");
  });
});
