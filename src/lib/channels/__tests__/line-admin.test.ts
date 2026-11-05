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

describe("デモのリセット", () => {
  it("架空のお客さんの分だけ消え、本物の LINE の人は残る（撮影用のデモの人はひも付けて入れ直す）", async () => {
    const st = await import("@/lib/channels/line/state");
    await st.touchUser("U_demo_kotori", { displayName: "デモ" });
    await st.touchUser("U-demo-DO-05", { displayName: "デモ2" });
    await st.touchUser("Uabcdef0123456789", { displayName: "本物" });
    await st.resetLineDemo();
    const users = Object.keys((await st.readLineState()).users);
    expect(users).toContain("Uabcdef0123456789");
    expect(users).not.toContain("U-demo-DO-05");
    expect((await st.readLineState()).outbox.some((m) => m.to === "U_demo_kotori")).toBe(false);
    // 撮影用のデモの人は、ひも付けた状態で入れ直す
    expect((await st.readLineState()).users["U_demo_kotori"]).toMatchObject({ customerId: "C06", linkedBy: "デモの初期値" });
  });
});

describe("取引先の CSV 一括登録（⑤の枠・③の列の決まり）", () => {
  const csv = (text: string) => new TextEncoder().encode(text);

  it("更新と追加ができ、LINE のひも付けは CSV で消えない", async () => {
    const o = await import("@/lib/channels/line/orders");
    const st = await import("@/lib/channels/line/state");
    const c = await import("@/lib/channels/line/customers");
    const svc = await import("@/lib/masters/service");
    await st.touchUser("U_real_csv", { displayName: "CSVの人" });
    await o.linkUserToCustomer("U_real_csv", "C05", "事務");
    const buf = csv("得意先ID,名前,主な注文の入口,注文の締め（前日）,納品時刻,配送コース\nC05,みどり食堂（デモ）,LINE,16:00,07:15,南コース\nC90,新しい店（デモ）,FAX,15:00,,\n");
    const p = await svc.previewUpload("customers", buf, "取引先.csv");
    expect(p.counts).toMatchObject({ add: 1, update: 1, error: 0 });
    await svc.applyUpload("customers", buf, "取引先.csv", "事務", p.hash);
    expect(await c.getCustomerSettings("C05")).toMatchObject({ channel: "line", cutoff: "16:00", deliveryTime: "07:15", course: "南コース", lineUserIds: ["U_real_csv"] });
    expect(await c.getCustomerSettings("C90")).toMatchObject({ name: "新しい店（デモ）", channel: "fax", active: true });
  });

  it("おかしな行があれば、行の番号つきでエラー（保存しない）", async () => {
    const svc = await import("@/lib/masters/service");
    const p = await svc.previewUpload("customers", csv("得意先ID,名前,主な注文の入口,注文の締め（前日）\nC91,だめな店,ハト,25:00\n"), "x.csv");
    expect(p.counts.error).toBe(1);
    expect(p.canApply).toBe(false);
  });
});
