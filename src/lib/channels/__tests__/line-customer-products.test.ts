// 取引先ごとの商品（LINE の注文フォーム）と、お客さま番号＋FAX の下4けたでのひも付け
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/store", () => import("./memdb"));

beforeAll(() => {
  process.env.HUB_DB_PATH = ":memory:";
});

describe("LINE: 取引先ごとの商品", () => {
  it("つながっていない人は、今までどおり基本の商品。own は false", async () => {
    const o = await import("@/lib/channels/line/orders");
    const ctx = await o.liffContext("U_test_new");
    expect(ctx.linked).toBe(false);
    expect(ctx.own).toBe(false);
    expect(ctx.productIds.length).toBeGreaterThan(0);
  });

  it("お客さま番号と FAX の下4けたが合えばつながる。合わなければ止める（ほかの会社の価格は見えない）", async () => {
    const o = await import("@/lib/channels/line/orders");
    const { loadMasters } = await import("@/lib/masters/seed-db");
    const m = await loadMasters();
    const c = m.customers.find((x) => (x.fax ?? "").replace(/\D/g, "").length >= 4 && (m.customerProducts ?? []).some((cp) => cp.customerId === x.id && cp.productId))!;
    expect(c).toBeDefined();
    const last4 = c.fax!.replace(/\D/g, "").slice(-4);
    // スイッチが OFF（はじめ）なら、番号でもつなげない
    await expect(o.claimCustomerByCode("U_test_claim", c.id, last4)).rejects.toThrow(/使えません/);
    (await import("@/lib/settings/features")).setFlag("line_own_products", true, "テスト");
    const wrong = last4 === "0000" ? "1111" : "0000";
    await expect(o.claimCustomerByCode("U_test_claim", c.id, wrong)).rejects.toThrow(/合いませんでした/);
    await expect(o.claimCustomerByCode("U_test_claim", "NOPE", last4)).rejects.toThrow(/合いませんでした/);
    expect((await o.claimCustomerByCode("U_test_claim", c.id.toLowerCase(), last4)).customerName).toBe(c.name);
    // つながると、その取引先に登録した商品だけ。名前・単位・卸価格・締めはその取引先の値
    const ctx = await o.liffContext("U_test_claim");
    expect(ctx.linked).toBe(true);
    expect(ctx.own).toBe(true);
    const mine = (m.customerProducts ?? []).filter((cp) => cp.customerId === c.id && cp.productId && cp.active !== false).map((cp) => cp.productId!);
    expect([...ctx.productIds].sort()).toEqual([...new Set(mine)].sort());
    const cp = (m.customerProducts ?? []).find((x) => x.customerId === c.id && x.productId === ctx.productIds[0])!;
    expect(ctx.items[ctx.productIds[0]].name).toBe(cp.name);
    expect(ctx.items[ctx.productIds[0]].lead).toMatch(/まで$/);
  });
});
