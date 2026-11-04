// ④ 取引先マスタの管理画面の LINE ひも付け（SQLite に保存）を確かめる。
// SQLite はメモリ（:memory:）。注文の保存（store.ts）はメモリの Db に差し替える。LINE には何も送らない。
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Order } from "@/data/types";
import { mem } from "./memdb";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/store", () => import("./memdb"));

beforeAll(() => {
  process.env.HUB_DB_PATH = ":memory:";
});

const lineOrder = (id: string, userId: string, customerId = ""): Order => ({
  id,
  customerId,
  deliveryDate: "2026-11-06",
  status: "needs_review",
  intent: "new",
  createdAt: "2026-11-05T01:00:00.000Z",
  edits: [],
  lines: [],
  source: { channel: "line", refs: [{ kind: "line_message", messageId: id, userId, text: "明日 ロール 20個" }], receivedAt: "2026-11-05T01:00:00.000Z", rawText: "明日 ロール 20個" },
});

describe("取引先マスタ（customers）", () => {
  it("はじめて読むと架空の取引先が入り、注文方法を直すと記録が残る", async () => {
    const c = await import("@/lib/channels/line/customers");
    const all = await c.listCustomerSettings();
    expect(all.length).toBeGreaterThanOrEqual(8);
    expect(all.find((x) => x.id === "C06")?.channel).toBe("line");
    await c.saveCustomerSettings("C04", { name: "喫茶こもれび", channel: "line", cutoff: "17:30", deliveryTime: "07:00", course: "Dコース" }, "事務");
    expect(await c.getCustomerSettings("C04")).toMatchObject({ channel: "line", cutoff: "17:30", deliveryTime: "07:00", course: "Dコース" });
    const { getMasterHistory } = await import("@/lib/db/masters");
    expect((await getMasterHistory("customers", "C04"))[0]).toMatchObject({ action: "update", who: "事務" });
  });

  it("おかしな時刻は保存しない", async () => {
    const c = await import("@/lib/channels/line/customers");
    await expect(c.saveCustomerSettings("C04", { name: "喫茶こもれび", channel: "line", cutoff: "25:00", deliveryTime: "07:00", course: "" }, "事務")).rejects.toThrow(/締め時刻/);
  });
});

describe("LINE の人のひも付け", () => {
  it("初回の人はひも付け待ち → 取引先を選ぶと、お店が不明の要確認注文にも入る（修正履歴つき）→ 解除できる", async () => {
    const st = await import("@/lib/channels/line/state");
    const o = await import("@/lib/channels/line/orders");
    const c = await import("@/lib/channels/line/customers");
    await st.touchUser("U_real_test1", { displayName: "テストの店主", firstMessage: "明日 ロール 20個" });
    mem.db.orders = [lineOrder("L1", "U_real_test1")];

    const waiting = await o.unlinkedLineUsers();
    expect(waiting.map((u) => u.userId)).toContain("U_real_test1");
    expect(waiting.find((u) => u.userId === "U_real_test1")).toMatchObject({ displayName: "テストの店主", firstMessage: "明日 ロール 20個", orders: 1 });

    await o.linkUserToCustomer("U_real_test1", "C04", "事務");
    expect(mem.db.orders[0].customerId).toBe("C04");
    expect(mem.db.orders[0].edits[0]).toMatchObject({ field: "customerId", from: "（不明）", to: "C04", who: "事務" });
    expect((await c.getCustomerSettings("C04"))?.lineUserIds).toContain("U_real_test1");
    expect((await o.unlinkedLineUsers()).map((u) => u.userId)).not.toContain("U_real_test1");

    await o.unlinkUser("U_real_test1", "事務");
    expect((await o.unlinkedLineUsers()).map((u) => u.userId)).toContain("U_real_test1");
    expect((await c.getCustomerSettings("C04"))?.lineUserIds ?? []).not.toContain("U_real_test1");
    expect(mem.db.orders[0].customerId).toBe("C04"); // もう入っている注文はそのまま
    const s = await st.readLineState();
    expect(s.linkLog.map((l) => l.action)).toEqual(["link", "unlink"]);
  });

  it("新しい取引先として登録して、ひも付けられる", async () => {
    const st = await import("@/lib/channels/line/state");
    const o = await import("@/lib/channels/line/orders");
    const c = await import("@/lib/channels/line/customers");
    await st.touchUser("U_real_test2", { displayName: "パン屋さん" });
    const id = await o.addCustomerAndLink("U_real_test2", { name: "喫茶ひだまり（デモ）", channel: "line", cutoff: "17:00", deliveryTime: "08:00", course: "Aコース" }, "事務");
    expect(id).toMatch(/^C\d+$/);
    expect(await c.getCustomerSettings(id)).toMatchObject({ name: "喫茶ひだまり（デモ）", lineUserIds: ["U_real_test2"] });
    expect((await st.readLineState()).users["U_real_test2"].customerId).toBe(id);
  });

  it("送った文面の記録は SQLite に残り、デモの人には本番でも送らない", async () => {
    const client = await import("@/lib/channels/line/client");
    const r = await client.pushText("U_demo_kotori", "テスト", "L1");
    expect(r.mode).toBe("demo");
    const s = await (await import("@/lib/channels/line/state")).readLineState();
    expect(s.outbox.at(-1)).toMatchObject({ to: "U_demo_kotori", via: "push", mode: "demo", orderId: "L1" });
  });
});
