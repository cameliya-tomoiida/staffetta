// ④ LINE: 確定の連絡に「代わりの日の提案」を入れる → お客さんの返事を変更（intent=change）として読む、を通しで確かめる。
// 時計は撮影と同じ DEMO_NOW=2026-11-05 11:30。デモの人なので本番の LINE には送らない（fetch を呼ばない）。
// Claude の読み取り（readLineText）は「Claude が返すはずの形」の見本に差し替え、渡された手がかり（最近の注文と提案）を記録する。
import { beforeAll, describe, expect, it, vi } from "vitest";
import { demoOrders } from "@/data/demo-orders";
import type { LineRead, RecentOrderBrief } from "@/lib/channels/line/reader";
import { mem } from "./memdb";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/store", () => import("./memdb"));

const reads: { text: string; recent: RecentOrderBrief[] }[] = [];
let nextRead: (recent: RecentOrderBrief[]) => LineRead;
vi.mock("@/lib/channels/line/reader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/channels/line/reader")>()),
  readLineText: async (text: string, _at: string, _known: Record<string, string>, recent: RecentOrderBrief[] = []) => {
    reads.push({ text, recent });
    return { read: nextRead(recent), model: "mock" };
  },
}));

const fetchSpy = vi.fn(async () => {
  throw new Error("本番の LINE に送ろうとしました");
});

const USER = "U_demo_kotori"; // デモの人（C06 ベーカリーカフェ ことり。日曜は納品なし）
const line = (written_name: string, product_id: string, quantity: number, unit_written: string) => ({
  written_name, product_id, quantity, unit_written, pieces_per_unit: 1, confidence: 0.95, attention: "",
});

beforeAll(async () => {
  process.env.HUB_DB_PATH = ":memory:";
  // この試験は人が確定する流れを見る（自動確定は line-auto.test.ts）
  (await import("@/lib/channels/line/auto")).setLineAutoSettings({ autoConfirm: false }, "試験");
  process.env.DEMO_NOW = "2026-11-05T11:30:00+09:00";
  process.env.LINE_CHANNEL_SECRET = "test-secret";
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
  vi.stubGlobal("fetch", fetchSpy);
  mem.db.orders = structuredClone(demoOrders);
  const st = await import("@/lib/channels/line/state");
  await st.resetLineDemo();
});

describe("確定の連絡の「代わりの日の提案」と、その返事", () => {
  it("締めのあとの行に代わりの日を出し、返事を変更の注文として読む", async () => {
    const o = await import("@/lib/channels/line/orders");
    const st = await import("@/lib/channels/line/state");
    const { confirmOrderAction } = await import("@/app/orders/actions");

    // 11/5 11:30 にトークで 11/6 の注文。超じゅくロール（仕入・前日 11:00 締め）は間に合わない、バターロール（自社・前日 18:00）は間に合う
    nextRead = () => ({
      is_order: true,
      notes: "",
      orders: [{ intent: "new", change_of_order_id: "", delivery_date: "2026-11-06", date_written: "明日", lines: [line("バターロール", "P01", 30, "個"), line("超じゅくロール", "P10", 2, "袋")] }],
    });
    const r = await o.ingestTalkMessage({ messageId: "alt1", userId: USER, text: "明日 バターロール30 超じゅくロール2袋", receivedAt: "2026-11-05T02:30:00.000Z" });
    const id = r.orders![0].id;

    // 人が受注一覧で確定（行はそのまま）
    await confirmOrderAction({ orderId: id, who: "事務 たなか", lines: [] });
    const order = mem.db.orders.find((x) => x.id === id)!;
    const offers = o.alternativeOffers(order);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ productId: "P10", quantity: 2, date: "2026-11-07" });

    // 確定の連絡（人が押したときだけ）。デモの人なので記録だけ・fetch は呼ばない
    expect(await o.notifyOrderConfirmed(id, "事務 たなか")).toMatchObject({ already: false, mode: "demo" });
    expect(fetchSpy).not.toHaveBeenCalled();
    const sent = (await st.readLineState()).outbox.filter((m) => m.orderId === id);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("・バターロール　30個");
    expect(sent[0].text).not.toContain("・超じゅくロール 6個入　2");
    expect(sent[0].text).toContain("【11月6日(金)には お届けできない商品】\n・超じゅくロール 6個入 2袋は 11月7日(土)なら お届けできます。");
    expect(sent[0].text).toContain("ご希望なら、このまま返信してください。");
    // 提案は注文に残る（返事を読む手がかり）
    expect(mem.db.orders.find((x) => x.id === id)!.source.extra?.lineAltOffer).toBe("超じゅくロール 6個入 2袋 → 2026-11-07");

    // お客さんの返事「お願いします」→ 読み取りには提案つきの注文が渡る → 変更（intent=change）の要確認になる
    nextRead = (recent) => {
      const target = recent.find((x) => x.altOffer)!;
      return {
        is_order: true,
        notes: "代わりの日の提案に応じる返事",
        orders: [{ intent: "change", change_of_order_id: target.id, delivery_date: "2026-11-07", date_written: "", lines: [line("超じゅくロール", "P10", 2, "袋")] }],
      };
    };
    const reply = await o.ingestTalkMessage({ messageId: "alt2", userId: USER, text: "お願いします", receivedAt: "2026-11-05T02:40:00.000Z" });
    const handed = reads.at(-1)!.recent.find((x) => x.id === id);
    expect(handed?.altOffer).toBe("超じゅくロール 6個入 2袋 → 2026-11-07");
    expect(reply.orders![0]).toMatchObject({ intent: "change", changeOf: id, deliveryDate: "2026-11-07", status: "needs_review" });
    expect(reply.orders![0].lines[0]).toMatchObject({ productId: "P10", quantity: 2 });
    // 元の注文は変わらない（直すのは人）
    expect(mem.db.orders.find((x) => x.id === id)!.lines).toHaveLength(2);
  });

  it("人が数を 0 にした行も「受けられない行」として提案する。取消・間に合う注文には何も足さない", async () => {
    const o = await import("@/lib/channels/line/orders");
    const base = structuredClone(mem.db.orders.find((x) => x.customerId === "C06" && x.status === "confirmed")!);
    base.source.receivedAt = "2026-11-04T09:00:00.000Z"; // 前日の朝（どの商品も間に合う）
    base.deliveryDate = "2026-11-06";
    base.intent = "new";
    base.lines = [
      { ...base.lines[0], id: "x1", productId: "P01", quantity: 10, unit: "個", read: { ...base.lines[0].read!, quantity: 10 } },
      { ...base.lines[0], id: "x2", productId: "P02", quantity: 0, unit: "個", read: { ...base.lines[0].read!, quantity: 5 } },
    ];
    const offers = o.alternativeOffers(base);
    expect(offers.map((x) => [x.productId, x.quantity])).toEqual([["P02", 5]]);
    expect(offers[0].date > "2026-11-06").toBe(true);

    const ok = { ...base, lines: [base.lines[0]] };
    expect(o.alternativeOffers(ok)).toEqual([]);
    expect(o.confirmationText(ok)).not.toContain("お届けできない");
    expect(o.alternativeOffers({ ...base, intent: "cancel" })).toEqual([]);
    // 受け付けたときは間に合っていた（11/4 朝）なら、連絡がいま（締め 11/5 11:00 のあと）でも提案しない
    const intime = { ...base, lines: [{ ...base.lines[0], id: "x3", productId: "P10", quantity: 2, unit: "袋" }] };
    expect(o.alternativeOffers(intime)).toEqual([]);
  });
});
