// ④ LINE の自動確定（A5 注文フォーム・A6 トーク）と、確定の連絡の自動送信（D2）。
// 時計は DEMO_NOW=2026-11-05 11:30。デモの人なので、自動送信でも本番の LINE には送らない（fetch を呼ばない）。
// Claude の読み取りは見本に差し替える。
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { demoOrders } from "@/data/demo-orders";
import type { LineRead } from "@/lib/channels/line/reader";
import { mem } from "./memdb";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/store", () => import("./memdb"));

let nextRead: LineRead;
vi.mock("@/lib/channels/line/reader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/channels/line/reader")>()),
  readLineText: async () => ({ read: nextRead, model: "mock" }),
}));

const fetchSpy = vi.fn(async () => {
  throw new Error("本番の LINE に送ろうとしました");
});

const KOTORI = "U_demo_kotori"; // C06 にひも付いたデモの人
const line = (written_name: string, product_id: string, quantity: number, unit_written: string, confidence = 0.95, attention = "") => ({
  written_name, product_id, quantity, unit_written, pieces_per_unit: 1, confidence, attention,
});
const talk = (date: string, lines: ReturnType<typeof line>[]): LineRead => ({
  is_order: true, notes: "", orders: [{ intent: "new", change_of_order_id: "", delivery_date: date, date_written: "9日", lines }],
});
let n = 0;
const send = async (userId: string, read: LineRead) => {
  nextRead = read;
  const o = await import("@/lib/channels/line/orders");
  const r = await o.ingestTalkMessage({ messageId: `auto${++n}`, userId, text: "（見本）", receivedAt: "2026-11-05T02:30:00.000Z" });
  return mem.db.orders.find((x) => x.id === r.orders![0].id)!;
};
const settings = async (v: { autoConfirm?: boolean; autoNotify?: boolean }) => (await import("@/lib/channels/line/auto")).setLineAutoSettings(v, "試験");
const outboxFor = async (orderId: string) => (await (await import("@/lib/channels/line/state")).readLineState()).outbox.filter((m) => m.orderId === orderId);

beforeAll(async () => {
  process.env.HUB_DB_PATH = ":memory:";
  process.env.DEMO_NOW = "2026-11-05T11:30:00+09:00";
  process.env.LINE_CHANNEL_SECRET = "test-secret";
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
  vi.stubGlobal("fetch", fetchSpy);
  mem.db.orders = structuredClone(demoOrders);
  await (await import("@/lib/channels/line/state")).resetLineDemo();
});
beforeEach(async () => {
  await settings({ autoConfirm: true, autoNotify: false }); // 既定
});

describe("設定の既定", () => {
  it("自動確定＝する、自動送信＝しない", async () => {
    const a = await import("@/lib/channels/line/auto");
    expect(a.DEFAULT_LINE_AUTO).toEqual({ autoConfirm: true, autoNotify: false });
  });
});

describe("A5 注文フォーム", () => {
  it("ひも付き済み・締めに通る → 自動で確定（確定した人＝自動）。自動送信が「しない」なら連絡は送らない", async () => {
    const o = await import("@/lib/channels/line/orders");
    const r = await o.createLiffOrder({ userId: KOTORI, deliveryDate: "2026-11-09", items: [{ productId: "P07", quantity: 4 }] });
    const saved = mem.db.orders.find((x) => x.id === r.id)!;
    expect(saved).toMatchObject({ status: "confirmed", confirmedBy: "自動（LINE・迷いなし）", source: { extra: { autoConfirmed: true } } });
    const { isAutoConfirmed } = await import("@/components/ui/AutoConfirmed");
    expect(isAutoConfirmed(saved)).toBe(true); // ②の札・取り消しボタンの見分け方
    expect(await outboxFor(r.id)).toHaveLength(0);
  });

  it("自動確定を「しない」にすると要確認のまま", async () => {
    await settings({ autoConfirm: false });
    const o = await import("@/lib/channels/line/orders");
    const r = await o.createLiffOrder({ userId: KOTORI, deliveryDate: "2026-11-10", items: [{ productId: "P07", quantity: 4 }] });
    expect(mem.db.orders.find((x) => x.id === r.id)!.status).toBe("needs_review");
  });

  it("はじめての LINE の人（お店が決まっていない）は要確認", async () => {
    const o = await import("@/lib/channels/line/orders");
    const r = await o.createLiffOrder({ userId: "U_demo_hajimete", deliveryDate: "2026-11-09", items: [{ productId: "P07", quantity: 4 }], claimedName: "パン好き食堂（架空）" });
    const saved = mem.db.orders.find((x) => x.id === r.id)!;
    expect(saved.status).toBe("needs_review");
    expect(saved.source.extra?.autoHold).toMatch(/どのお店か決まっていません/);
  });
});

describe("A6 トーク", () => {
  it("商品名どおり・自信が高い・締めに通る → 自動で確定", async () => {
    const o = await send(KOTORI, talk("2026-11-09", [line("バターロール", "P01", 30, "個"), line("黒糖ロール", "P02", 20, "個")]));
    expect(o).toMatchObject({ status: "confirmed", confirmedBy: "自動（LINE・迷いなし）" });
  });

  it("推測の呼び名・印のある行・締めのあとの行・変更の連絡は要確認（わけを残す）", async () => {
    const guess = await send(KOTORI, talk("2026-11-09", [line("バタロ", "P01", 30, "個", 0.6, "商品の対応が推測")]));
    expect(guess.status).toBe("needs_review");
    expect(guess.source.extra?.autoHold).toMatch(/商品の対応が推測/);

    const late = await send(KOTORI, talk("2026-11-06", [line("超じゅくロール 6個入", "P10", 2, "袋")]));
    expect(late.status).toBe("needs_review");
    expect(late.source.extra?.autoHold).toMatch(/11\/5 11:00 が締め/);

    nextRead = { is_order: true, notes: "変更", orders: [{ intent: "change", change_of_order_id: "", delivery_date: "2026-11-09", date_written: "", lines: [line("バターロール", "P01", 40, "個")] }] };
    const o = await import("@/lib/channels/line/orders");
    const r = await o.ingestTalkMessage({ messageId: `auto${++n}`, userId: KOTORI, text: "（見本）", receivedAt: "2026-11-05T02:30:00.000Z" });
    expect(mem.db.orders.find((x) => x.id === r.orders![0].id)!.status).toBe("needs_review");
  });

  it("名寄せ辞書にある呼び名なら、商品名どおりでなくても自動で確定", async () => {
    const { addAlias } = await import("@/lib/aliases");
    await addAlias({ customerId: "C06", alias: "黒ロール", productId: "P02", source: "line", who: "試験" });
    const o = await send(KOTORI, talk("2026-11-09", [line("黒ロール", "P02", 10, "個", 0.95)]));
    expect(o.status).toBe("confirmed");
  });
});

describe("D2 確定の連絡の自動送信と、取り消し", () => {
  it("自動送信「する」: 全部受けられる注文は確定と同時に送る（デモの人は記録だけ・fetch なし）。送ったあとは取り消せない", async () => {
    await settings({ autoNotify: true });
    const o = await send(KOTORI, talk("2026-11-09", [line("バターロール", "P01", 12, "個")]));
    expect(o.status).toBe("confirmed");
    const sent = await outboxFor(o.id);
    expect(sent).toHaveLength(1);
    expect(sent[0].mode).toBe("demo");
    expect(o.source.extra).toMatchObject({ lineNotifiedBy: "自動" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("人が確定した注文も、全部受けられれば自動で送る。受けられない行があれば送らない（人が見て送る）", async () => {
    await settings({ autoNotify: true });
    const { confirmOrderAction } = await import("@/app/orders/actions");
    const ok = await send(KOTORI, talk("2026-11-09", [line("バタロ", "P01", 5, "個", 0.6, "商品の対応が推測")]));
    await confirmOrderAction({ orderId: ok.id, who: "たなか", lines: [] });
    expect(await outboxFor(ok.id)).toHaveLength(1);

    const late = await send(KOTORI, talk("2026-11-06", [line("超じゅくロール 6個入", "P10", 2, "袋")]));
    await confirmOrderAction({ orderId: late.id, who: "たなか", lines: [] });
    expect(mem.db.orders.find((x) => x.id === late.id)!.status).toBe("confirmed");
    expect(await outboxFor(late.id)).toHaveLength(0);
  });

  it("自動で確定した注文は、⑤の取り消しで要確認に戻せる（記録が残る）", async () => {
    const o = await send(KOTORI, talk("2026-11-10", [line("バターロール", "P01", 8, "個")]));
    expect(o.status).toBe("confirmed");
    const { undoAutoConfirm } = await import("@/lib/automation/orders");
    await undoAutoConfirm(o.id, "たなか");
    const back = mem.db.orders.find((x) => x.id === o.id)!;
    expect(back.status).toBe("needs_review");
    expect(back.confirmedBy).toBeUndefined();
    expect(back.edits.at(-1)).toMatchObject({ who: "たなか", from: "自動（LINE・迷いなし）" });
  });
});

describe("機能の ON/OFF（①の一覧）", () => {
  it("「LINE 注文」を使わないにすると、注文フォームは受けず、トークからも注文を作らない", async () => {
    const { setFlag } = await import("@/lib/settings/features");
    setFlag("line_orders", false, "試験");
    try {
      const o = await import("@/lib/channels/line/orders");
      await expect(o.createLiffOrder({ userId: KOTORI, deliveryDate: "2026-11-09", items: [{ productId: "P07", quantity: 1 }] })).rejects.toThrow(/受け付けていません/);
      nextRead = talk("2026-11-09", [line("バターロール", "P01", 3, "個")]);
      const r = await o.ingestTalkMessage({ messageId: `off${++n}`, userId: KOTORI, text: "（見本）", receivedAt: "2026-11-05T02:30:00.000Z" });
      expect(r.orders).toHaveLength(0);
      // 自動確定・自動送信も OFF 扱い
      const a = await import("@/lib/channels/line/auto");
      expect(a.getLineAutoSettings()).toEqual({ autoConfirm: false, autoNotify: false });
    } finally {
      setFlag("line_orders", true, "試験");
    }
  });
});
