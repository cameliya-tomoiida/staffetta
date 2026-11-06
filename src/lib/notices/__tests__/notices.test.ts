import { beforeEach, describe, expect, it } from "vitest";
import { channelFor, checkNotice, itemLine, pickRecipients, templateDraft, type NoticeInput } from "../plan";
import { getDb } from "@/lib/db/sqlite";

const customers = [
  { id: "C01", course: "東コース", active: true },
  { id: "C02", course: "西コース", active: true },
  { id: "C03", course: "東コース", active: false },
  { id: "C04", active: true },
];
const buys = (c: string) => new Set(c === "C01" ? ["P01"] : c === "C04" ? ["P01", "P02"] : []);
const input: NoticeInput = { kind: "price_up", effectiveDate: "2026-12-01", items: [{ productId: "P01", name: "バターロール", oldPrice: 38, newPrice: 42 }], reason: "原材料の値上がり" };

describe("お知らせの決まり", () => {
  it("送る先: 全部・コース・その商品を買っている所（使っていない取引先は入れない）", () => {
    expect(pickRecipients(customers, { mode: "all" }, buys)).toEqual(["C01", "C02", "C04"]);
    expect(pickRecipients(customers, { mode: "course", courses: ["東コース"] }, buys)).toEqual(["C01"]);
    expect(pickRecipients(customers, { mode: "product", productIds: ["P02"] }, buys)).toEqual(["C04"]);
    expect(pickRecipients(customers, { mode: "product", productIds: ["P01"] }, buys)).toEqual(["C01", "C04"]);
  });

  it("手段: LINE があれば LINE、無ければ FAX、どちらも無ければ手渡し", () => {
    expect(channelFor({ fax: "000-1" }, ["U1"])).toEqual({ channel: "line", to: ["U1"] });
    expect(channelFor({ fax: "000-1" }, [])).toEqual({ channel: "fax", to: ["000-1"] });
    expect(channelFor({}, [])).toEqual({ channel: "none", to: [] });
  });

  it("決まりの文: 題・いつから・わけ・商品の行が入る。値上げに新しい価格が無ければ止める", () => {
    expect(itemLine(input.items[0])).toBe("・バターロール 38円 → 42円");
    const d = templateDraft(input, { name: "あさひ製パン工場（デモ）" });
    expect(d.title).toBe("価格改定のお願い");
    expect(d.body).toContain("原材料の値上がりにより、2026年12月1日納品分より下記の商品の価格を改定");
    expect(d.body).toContain("・バターロール 38円 → 42円");
    expect(d.line).toContain("あさひ製パン工場（デモ）です");
    expect(checkNotice(input, d)).toEqual([]);
    expect(checkNotice({ ...input, items: [{ name: "食パン" }] }, d)).toEqual(["値上げの商品に、新しい価格を入れてください"]);
  });
});

describe("下書き → OK → 送る（LINE は本番でなければ記録だけ）", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM kv WHERE key IN ('customer_notices', 'ai_settings') OR key LIKE 'feature_flags%'");
  });

  it("送信の鍵が OFF（はじめ）なら、OK を押しても本物のお客さんには送らず「送っていない」。FAX の「送った」も止める", async () => {
    const s = await import("../store");
    const { setFlag } = await import("@/lib/settings/features");
    setFlag("notice_send", false, "はやし");
    const env = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const { draft, by } = await s.draftNotice(input);
    const n = await s.saveNoticeDraft(input, draft, by, { mode: "all" }, "うえの");
    const sent = await s.sendNotice(n.id, "はやし");
    const real = sent.recipients.filter((r) => !(r.channel === "line" && s.isDemoCustomerName(r.name)));
    expect(real.length).toBeGreaterThan(0);
    expect(real.every((r) => r.status === "held")).toBe(true);
    expect(() => s.markDelivered(n.id, "", "うえの")).toThrow(/送信の鍵が OFF/);
    expect(s.isDemoCustomerName("こすもす保育園（デモ）")).toBe(true);
    expect(s.isDemoCustomerName("ひまわり保育園")).toBe(false);
    if (env) process.env.ANTHROPIC_API_KEY = env;
  });

  it("下書きでは送らない。鍵が ON なら OK で LINE は送り、FAX は印刷待ち。FAX を送ったら記録", async () => {
    const s = await import("../store");
    (await import("@/lib/settings/features")).setFlag("notice_send", true, "はやし");
    const env = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const { draft, by } = await s.draftNotice(input);
    expect(by).toBe("決まりの文");
    const n = await s.saveNoticeDraft(input, draft, by, { mode: "all" }, "うえの");
    expect(n.status).toBe("draft");
    expect(n.recipients.length).toBeGreaterThan(0);
    expect(n.recipients.every((r) => r.status === "waiting")).toBe(true);
    await expect(s.sendNotice(n.id, "")).rejects.toThrow(/OK を押す人/);
    const sent = await s.sendNotice(n.id, "はやし");
    expect(sent).toMatchObject({ status: "sent", approvedBy: "はやし" });
    expect(sent.recipients.every((r) => r.status !== "waiting")).toBe(true);
    await expect(s.sendNotice(n.id, "はやし")).rejects.toThrow(/もう送りました/);
    const done = s.markDelivered(n.id, "", "うえの");
    expect(done.recipients.filter((r) => r.channel !== "line").every((r) => r.status === "sent" && r.by === "うえの")).toBe(true);
    if (env) process.env.ANTHROPIC_API_KEY = env;
  });
});
