// ⑥の撮影の LINE の場面を、3106 と同じ時計（DEMO_NOW=2026-11-05 11:30）とデモの人で通しで確かめる。
//   デモを最初から → リッチメニュー「前回と同じ」（LIFF）→ 受付（要確認）→ 受注一覧で確定 → 確定の連絡
// 本番の LINE の設定（トークン）が入っていても、デモの人には送らない（fetch を呼ばない）ことも確かめる。
// SQLite はメモリ、注文の保存（store.ts）はメモリの Db。
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DEMO_DATE, demoOrders } from "@/data/demo-orders";
import { mem } from "./memdb";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/store", () => import("./memdb"));

const fetchSpy = vi.fn(async () => {
  throw new Error("本番の LINE に送ろうとしました");
});

beforeAll(async () => {
  process.env.HUB_DB_PATH = ":memory:";
  // この試験は人が確定する流れを見る（自動確定は line-auto.test.ts）
  (await import("@/lib/channels/line/auto")).setLineAutoSettings({ autoConfirm: false }, "試験");
  process.env.DEMO_NOW = "2026-11-05T11:30:00+09:00";
  // 本番と同じく LINE の設定が入っている状態（値は架空）
  process.env.LINE_CHANNEL_SECRET = "test-secret";
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
  vi.stubGlobal("fetch", fetchSpy);
});

describe("撮影の LINE の場面（デモの人・DEMO_NOW）", () => {
  it("前回と同じ → 受付 → 確定 → 確定の連絡 が通しで動き、本番の LINE には何も送らない", async () => {
    const { todayJst } = await import("@/lib/clock");
    expect(todayJst()).toBe("2026-11-05");
    expect(DEMO_DATE).toBe("2026-11-06");

    // デモを最初から（①の resetDb と同じ順: 注文をデモに戻す → LINE は架空の人だけ入れ直す）
    mem.db.orders = structuredClone(demoOrders);
    const st = await import("@/lib/channels/line/state");
    await st.resetLineDemo();

    // リッチメニュー「前回と同じ」: ひも付け済みで、前回の注文が出る
    const o = await import("@/lib/channels/line/orders");
    const ctx = await o.liffContext("U_demo_kotori");
    expect(ctx).toMatchObject({ linked: true, customerName: "ベーカリーカフェ ことり" });
    expect(ctx.lastOrder?.items.length).toBeGreaterThan(0);

    // 注文フォームから送る（納品は明日 = デモの日）
    const created = await o.createLiffOrder({ userId: "U_demo_kotori", deliveryDate: DEMO_DATE, items: ctx.lastOrder!.items, repeat: true });
    const id = created.id;
    const order = mem.db.orders.find((x) => x.id === id)!;
    expect(order).toMatchObject({ customerId: "C06", status: "needs_review", deliveryDate: DEMO_DATE, source: { channel: "line" } });
    expect(order.source.receivedAt.startsWith("2026-11-05T02:30")).toBe(true); // DEMO_NOW の時刻で受信

    // 受注一覧で確定（人が押す）
    const { confirmOrderAction } = await import("@/app/orders/actions");
    const r = await confirmOrderAction({ orderId: id, who: "事務 たなか", lines: [] });
    expect(r).toMatchObject({ ok: true, channel: "line" });
    expect(mem.db.orders.find((x) => x.id === id)!.status).toBe("confirmed");

    // 確定の連絡: デモの人なので記録だけ（本番の LINE には送らない）。2回目は送らない
    const sent = await o.notifyOrderConfirmed(id, "事務 たなか");
    expect(sent).toMatchObject({ already: false, mode: "demo" });
    expect(await o.notifyOrderConfirmed(id, "事務 たなか")).toMatchObject({ already: true });
    const out = (await st.readLineState()).outbox.filter((m) => m.orderId === id);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ to: "U_demo_kotori", via: "push", mode: "demo" });
    expect(out[0].text).toMatch(/確定/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
