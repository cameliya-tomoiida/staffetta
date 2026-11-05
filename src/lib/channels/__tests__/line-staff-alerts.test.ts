// ④ 大事なアラートをスタッフの LINE に送る。本番の LINE の設定が入っていても、デモの人には送らない（fetch を呼ばない）。
// 時計は DEMO_NOW（昼 11:30）。夜の試験だけ DEMO_NOW を 23:00 に変える（共通の時計は毎回 DEMO_NOW を読む）。
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { demoOrders } from "@/data/demo-orders";
import { mem } from "./memdb";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/store", () => import("./memdb"));

const fetchSpy = vi.fn(async () => {
  throw new Error("本番の LINE に送ろうとしました");
});
const NOON = "2026-11-05T11:30:00+09:00";
const MORITA = "U_demo_staff_morita"; // 架空のスタッフ（デモの人なので記録だけ）
const SATO = "U_demo_staff_sato";

const sa = () => import("@/lib/channels/line/staff-alerts");
const danger = { key: "stock:M01:2026-11-07", level: "danger" as const, title: "材料が足りなくなります：強力粉（11/7）", action: "発注書の下書きができています", href: "/purchase" };

beforeAll(async () => {
  process.env.HUB_DB_PATH = ":memory:";
  process.env.DEMO_NOW = NOON;
  process.env.LINE_CHANNEL_SECRET = "test-secret";
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
  process.env.HUB_APP_URL = "http://192.168.0.10:3100";
  vi.stubGlobal("fetch", fetchSpy);
  mem.db.orders = structuredClone(demoOrders);
  const st = await import("@/lib/channels/line/state");
  await st.resetLineDemo(); // U_demo_kotori はお客さん（C06）
  await st.touchUser(MORITA, { displayName: "もりた（架空）" });
  await st.touchUser(SATO, { displayName: "さとう（架空）" });
});
afterEach(() => {
  process.env.DEMO_NOW = NOON;
});

describe("スタッフの LINE へのアラート", () => {
  it("既定はオフ（送らない）", async () => {
    const s = await sa();
    expect(s.getStaffAlertSettings().enabled).toBe(false);
    const r = await s.sendAlertsToStaff([danger]);
    expect(r.sent).toHaveLength(0);
    expect(r.skipped[0].why).toBe("設定でオフ");
  });

  it("お客さんにひも付いた LINE の人は、スタッフにできない。スタッフはひも付け待ちの一覧に出ない", async () => {
    const s = await sa();
    await expect(s.addStaffLine({ userId: "U_demo_kotori", name: "ことり" }, "事務")).rejects.toThrow(/お客さん/);
    await s.addStaffLine({ userId: MORITA, name: "もりた", allDanger: true }, "事務");
    await s.addStaffLine({ userId: SATO, name: "さとう", allDanger: false }, "事務");
    const { unlinkedLineUsers } = await import("@/lib/channels/line/orders");
    const waiting = (await unlinkedLineUsers()).map((u) => u.userId);
    expect(waiting).not.toContain(MORITA);
    expect(waiting).not.toContain(SATO);
  });

  it("オンにすると、大事なものは全部受け取る人へ。短い文とアプリのリンク。同じものは1日1回まで", async () => {
    const s = await sa();
    s.setStaffAlertSettings({ enabled: true }, "事務");
    const r = await s.sendAlertsToStaff([danger]);
    expect(r.sent).toEqual([{ key: danger.key, to: MORITA, name: "もりた", mode: "demo" }]);
    const st = await import("@/lib/channels/line/state");
    const msg = (await st.readLineState()).outbox.filter((m) => m.to === MORITA).at(-1)!;
    expect(msg.text).toBe("【STAFFETTA】材料が足りなくなります：強力粉（11/7）。発注書の下書きができています\nhttp://192.168.0.10:3100/purchase");
    const again = await s.sendAlertsToStaff([danger]);
    expect(again.sent).toHaveLength(0);
    expect(again.skipped[0].why).toBe("今日はもう送った");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("大事でないものは送らない。回されたものは、その人だけに送る", async () => {
    const s = await sa();
    const warn = { key: "review:30min", level: "warn" as const, title: "要確認が30分たまっています" };
    expect((await s.sendAlertsToStaff([warn])).sent).toHaveLength(0);
    const assigned = { key: "review:assigned", level: "warn" as const, title: "原価の見直しをお願いします：バターロール", assignee: "さとう", href: "/alerts" };
    const r = await s.sendAlertsToStaff([assigned]);
    expect(r.sent.map((x) => x.to)).toEqual([SATO]);
  });

  it("夜（22時〜6時）は送らない", async () => {
    const s = await sa();
    expect(s.isQuietHours(Date.parse("2026-11-05T22:00:00+09:00"))).toBe(true);
    expect(s.isQuietHours(Date.parse("2026-11-06T05:59:00+09:00"))).toBe(true);
    expect(s.isQuietHours(Date.parse("2026-11-06T06:00:00+09:00"))).toBe(false);
    process.env.DEMO_NOW = "2026-11-05T23:00:00+09:00";
    const r = await s.sendAlertsToStaff([{ ...danger, key: "night:1" }]);
    expect(r.sent).toHaveLength(0);
    expect(r.skipped[0].why).toMatch(/夜/);
  });

  it("スタッフのあとでお客さんにひも付いた LINE の人には、送らない", async () => {
    const s = await sa();
    const st = await import("@/lib/channels/line/state");
    await st.updateLineState((x) => {
      x.users[SATO] = { ...x.users[SATO], customerId: "C04" };
    });
    const r = await s.sendAlertsToStaff([{ key: "x:1", level: "warn", title: "見本", assignee: "さとう" }]);
    expect(r.sent).toHaveLength(0);
    expect(r.skipped[0].why).toBe("お客さんにひも付いている");
  });
});
