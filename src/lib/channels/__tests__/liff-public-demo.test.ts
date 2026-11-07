// 審査員向けの見本（HUB_DEMO=1・Render）では、LINE の注文フォームを外のブラウザから架空のお客さん（U_demo_…）で使える。
// 本番（HUB_DEMO なし）は今までどおり、外からは LINE の本人確認が要る。見本でも本物の LINE の人にはなれない（11/8 管理役2）
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { demoOrders } from "@/data/demo-orders";
import { mem } from "./memdb";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/store", () => import("./memdb"));
// 外（Render）から来たときの見出し
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "staffetta-demo.onrender.com" }) }));
// LINE ログインのチャネルがあるサーバー（本番 3100 と同じ）を試す
vi.mock("@/lib/channels/line/config", () => ({ lineConfig: { loginChannelId: "1234567890" } }));

beforeAll(async () => {
  process.env.HUB_DB_PATH = ":memory:";
  mem.db.orders = structuredClone(demoOrders);
  await (await import("@/lib/channels/line/state")).resetLineDemo();
});
afterEach(() => {
  delete process.env.HUB_DEMO;
});

describe("LIFF の注文フォーム（見本）", () => {
  it("見本では、外からでも架空のお客さんで開ける", async () => {
    process.env.HUB_DEMO = "1";
    const { liffLoadAction } = await import("@/lib/channels/line/actions");
    await expect(liffLoadAction({ demoUserId: "U_demo_kotori" })).resolves.toBeTruthy();
  });
  it("見本でも、本物の LINE の人（U_demo_ 以外）にはなれない", async () => {
    process.env.HUB_DEMO = "1";
    const { liffLoadAction } = await import("@/lib/channels/line/actions");
    await expect(liffLoadAction({ demoUserId: "Uabcdef0123456789" })).rejects.toThrow(/LINEアプリから開いてください/);
  });
  it("本番（HUB_DEMO なし）は、外から架空のお客さんでも開けない（LINE の本人確認が要る）", async () => {
    const { liffLoadAction } = await import("@/lib/channels/line/actions");
    await expect(liffLoadAction({ demoUserId: "U_demo_kotori" })).rejects.toThrow(/LINEアプリから開いてください/);
  });
});
