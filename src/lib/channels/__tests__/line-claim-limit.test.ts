// お客さま番号でつなぐ: 続けて間違えたら止める（1時間に5回まで）・もうつながっている人は付け替えられない（セキュリティの確認 11/7）
import { beforeAll, describe, expect, it, vi } from "vitest";
import { demoOrders } from "@/data/demo-orders";
import { mem } from "./memdb";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/store", () => import("./memdb"));

beforeAll(async () => {
  process.env.HUB_DB_PATH = ":memory:";
  mem.db.orders = structuredClone(demoOrders);
  (await import("@/lib/settings/features")).setFlag("line_own_products", true, "試験");
  await (await import("@/lib/channels/line/state")).resetLineDemo();
});

describe("claimCustomerByCode", () => {
  it("5回まちがえたら、正しくても止める", async () => {
    const o = await import("@/lib/channels/line/orders");
    for (let i = 0; i < 5; i++) await expect(o.claimCustomerByCode("U_new_1", "C01", "0000", "1.2.3.4")).rejects.toThrow(/番号が合いませんでした/);
    await expect(o.claimCustomerByCode("U_new_1", "C01", "0000", "1.2.3.4")).rejects.toThrow(/しばらく使えません/);
    // 同じ接続元の別の人も止まる
    await expect(o.claimCustomerByCode("U_new_2", "C01", "0000", "1.2.3.4")).rejects.toThrow(/しばらく使えません/);
  });
  it("もうつながっている人は付け替えられない", async () => {
    const o = await import("@/lib/channels/line/orders");
    await expect(o.claimCustomerByCode("U_demo_kotori", "C01", "0000", "5.6.7.8")).rejects.toThrow(/もうつながっています/);
  });
});
