// 受注の「確定」の守り: 得意先が空、または商品が空の行がある注文は、人の確定でも自動の確定でも確定しない。
// （本番で、得意先も商品も空の LINE の試し注文が確定済みになり、製造計画の注意に16件出ていた）
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "@/data/types";
import { mem, resetMem } from "@/lib/channels/__tests__/memdb";
import { CONFIRM_BLOCKED_MESSAGE, confirmBlocker } from "@/lib/confirm-guard";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/store", () => import("@/lib/channels/__tests__/memdb"));

const WHO = "事務 たなか";
const order = (id: string, over: Partial<Order> = {}, lines: Partial<Order["lines"][number]>[] = [{}]): Order => ({
  id,
  intent: "new",
  customerId: "C06",
  deliveryDate: "2026-11-09",
  status: "needs_review",
  createdAt: "2026-11-05T02:00:00.000Z",
  edits: [],
  source: { channel: "line", refs: [], receivedAt: "2026-11-05T02:00:00.000Z" },
  lines: lines.map((l, i) => ({ id: `${id}-${i}`, productId: "P01", quantity: 10, unit: "個", piecesPerUnit: 1, pieces: 10, confidence: 1, edits: [], ...l })),
  ...over,
});

beforeEach(() => resetMem());
beforeAll(async () => {
  const { saveAutomationSettings } = await import("../settings");
  saveAutomationSettings({ importAutoConfirm: true }, "テスト");
});

describe("confirmBlocker", () => {
  it("得意先が空・商品が空の行（個数あり）・行なし は止める。個数 0 の空の行は止めない", () => {
    expect(confirmBlocker(order("A"))).toBeUndefined();
    expect(confirmBlocker(order("A", { customerId: "" }))).toBe(CONFIRM_BLOCKED_MESSAGE);
    expect(confirmBlocker(order("A", { customerId: "  " }))).toBe(CONFIRM_BLOCKED_MESSAGE);
    expect(confirmBlocker(order("A", {}, [{}, { productId: "" }]))).toBe(CONFIRM_BLOCKED_MESSAGE);
    expect(confirmBlocker(order("A", {}, []))).toBe(CONFIRM_BLOCKED_MESSAGE);
    expect(confirmBlocker(order("A", {}, [{}, { productId: "", quantity: 0 }]))).toBeUndefined();
    expect(confirmBlocker(order("A", {}, [{ productId: "", quantity: 0 }]))).toBe(CONFIRM_BLOCKED_MESSAGE);
  });
});

describe("人の確定（受注一覧の確定）", () => {
  it("得意先も商品も空の LINE の試し注文は確定できず、画面に「お店（得意先）と商品を決めてから確定してください」と出る", async () => {
    const { confirmOrderAction } = await import("@/app/orders/actions");
    mem.db.orders = [order("T1", { customerId: "" }, [{ productId: "", quantity: 1 }])];
    const r = await confirmOrderAction({ orderId: "T1", who: WHO, lines: [{ lineId: "T1-0", quantity: 1 }] });
    expect(r).toEqual({ ok: false, error: CONFIRM_BLOCKED_MESSAGE });
    expect(mem.db.orders[0].status).toBe("needs_review");
  });

  it("得意先を選んでも、商品が空の行があれば確定できない（メッセージは同じ言葉ではじまる）", async () => {
    const { confirmOrderAction } = await import("@/app/orders/actions");
    mem.db.orders = [order("T2", {}, [{}, { productId: "", quantity: 2, read: { writtenName: "なぞのパン", quantity: 2, unitWritten: "個", piecesPerUnit: 1, productId: "", confidence: 0.2, attention: "" } }])];
    const r = await confirmOrderAction({ orderId: "T2", who: WHO, lines: [] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(new RegExp(`^${CONFIRM_BLOCKED_MESSAGE}.*なぞのパン`));
    expect(mem.db.orders[0].status).toBe("needs_review");
  });

  it("得意先と商品が決まっていれば確定できる。全部 0 にした取り消しは今までどおりできる", async () => {
    const { confirmOrderAction } = await import("@/app/orders/actions");
    mem.db.orders = [order("T3"), order("T4", {}, [{}, { productId: "", quantity: 0 }])];
    expect(await confirmOrderAction({ orderId: "T3", who: WHO, lines: [] })).toMatchObject({ ok: true });
    expect(mem.db.orders[0].status).toBe("confirmed");
    expect(await confirmOrderAction({ orderId: "T4", who: WHO, lines: [] })).toMatchObject({ ok: true });
    expect(mem.db.orders[1].status).toBe("confirmed");
  });
});

describe("自動の確定", () => {
  it("取り込みの自動確定: 得意先が空なら確定せず、人に回す（理由が残る）", async () => {
    const { autoConfirmImported } = await import("../orders");
    mem.db.orders = [order("IM-A", { customerId: "", source: { channel: "infomart", refs: [], receivedAt: "2026-11-01T00:00:00Z" } })];
    const r = await autoConfirmImported(["IM-A"]);
    expect(r.confirmed).toEqual([]);
    expect(r.held[0]?.id).toBe("IM-A");
    expect(mem.db.orders[0].status).toBe("needs_review");
  });

  it("LINE の自動確定: 得意先も商品も空の注文は確定しない（autoHold にわけが残る）", async () => {
    const { autoConfirmLineOrders, setLineAutoSettings } = await import("@/lib/channels/line/auto");
    setLineAutoSettings({ autoConfirm: true, autoNotify: false }, "テスト");
    mem.db.orders = [order("L1", { customerId: "" }, [{ productId: "", quantity: 1 }])];
    const r = await autoConfirmLineOrders(["L1"]);
    expect(r.confirmed).toEqual([]);
    expect(mem.db.orders[0].status).toBe("needs_review");
    expect(String(mem.db.orders[0].source.extra?.autoHold)).toMatch(/決まって/);
  });
});

describe("変更FAX の確定", () => {
  it("得意先が空では確定できない", async () => {
    const { confirmChangeAction } = await import("@/app/actions");
    await expect(confirmChangeAction({ faxId: "F999", customerId: "", rotation: 0, who: WHO, changes: [], additions: [] })).rejects.toThrow(CONFIRM_BLOCKED_MESSAGE);
  });
});
