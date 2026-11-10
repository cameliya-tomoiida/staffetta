import { beforeEach, describe, expect, it, vi } from "vitest";

// Claude は呼ばない（道具を使う返事を順番に決めておく）
const create = vi.fn();
vi.mock("../client", () => ({ aiClient: () => ({ messages: { create } }) }));

import { confirmPending, runAgent, toolsFor } from "../agent";
import { setAiSettings } from "../settings";
import { loadDb, resetToDemo } from "@/lib/db/hub-store";
import { getDb, kvGet } from "@/lib/db/sqlite";
import { listMaster } from "@/lib/db/masters";

const toolUse = (id: string, name: string, input: unknown) => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id, name, input }] });
const final = (text: string) => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });
const base = { userKey: "ST01", name: "たなか", path: "/orders", pageText: "", today: "2026-11-06" };

describe("AI に頼む（tool use）", () => {
  beforeEach(async () => {
    await resetToDemo();
    getDb().exec("DELETE FROM kv WHERE key LIKE 'ai_%'");
    setAiSettings({ apiKey: "sk-ant-test0123456789abcdefghijklmnop" }, "はやし");
    create.mockReset();
  });

  it("役割で渡す道具を分ける（工場に注文を入れる・粗利の道具は渡さない）", () => {
    const names = (r: Parameters<typeof toolsFor>[0]) => toolsFor(r).map((t) => t.name);
    expect(names("工場")).not.toContain("add_order");
    expect(names("工場")).not.toContain("customer_profit");
    expect(names("工場")).toContain("plan_summary");
    expect(names("事務")).toContain("add_order");
    expect(names("事務")).not.toContain("customer_profit");
    expect(names("管理者")).toContain("customer_profit");
    expect(names("配送")).toEqual(expect.arrayContaining(["add_order", "find_customer"]));
  });

  it("「来週月曜、C03 にバターロール50個追加」→ 探してから要確認の注文を入れる。やったことは記録", async () => {
    create
      .mockResolvedValueOnce(toolUse("t1", "find_product", { query: "バターロール" }))
      .mockResolvedValueOnce(toolUse("t2", "add_order", { customerId: "C03", deliveryDate: "2026-11-09", items: [{ productId: "P01", quantity: 50 }] }))
      .mockResolvedValueOnce(final("11/9(月) に みなと給食センターへ バターロール 50個 を要確認で入れました。"));
    const before = (await loadDb()).orders.length;
    const a = await runAgent({ ...base, role: "事務", message: "来週月曜、C03 にバターロール50個追加" });
    const db = await loadDb();
    expect(db.orders.length).toBe(before + 1);
    const o = db.orders.find((x) => String(x.source.extra?.takenBy ?? "").includes("AI に頼んだ"))!;
    expect(o).toMatchObject({ customerId: "C03", deliveryDate: "2026-11-09", status: "needs_review" });
    expect(o.lines.map((l) => [l.productId, l.quantity])).toEqual([["P01", 50]]);
    expect(a.did?.[0]).toMatch(/要確認で入れました/);
    expect(a.links?.[0].href).toBe("/orders?status=needs_review");
    // 道具の結果は Claude に返している（2回目の呼び出しに tool_result がある）
    const sent = create.mock.calls[1][0].messages as { content: unknown }[];
    expect(sent.some((m) => Array.isArray(m.content) && m.content.some((c: { type?: string; tool_use_id?: string }) => c.type === "tool_result" && c.tool_use_id === "t1"))).toBe(true);
    expect((kvGet<unknown[]>("ai_agent_log") ?? []).length).toBe(2);
  });

  it("工場の人が注文の道具を呼んでも使えない（渡していない道具）", async () => {
    create.mockResolvedValueOnce(toolUse("t1", "add_order", { customerId: "C03", deliveryDate: "2026-11-09", items: [{ productId: "P01", quantity: 5 }] })).mockResolvedValueOnce(final("できません"));
    const before = (await loadDb()).orders.length;
    await runAgent({ ...base, role: "工場", message: "注文を入れて" });
    expect((await loadDb()).orders.length).toBe(before);
    expect(create.mock.calls[0][0].tools.map((t: { name: string }) => t.name)).not.toContain("add_order");
    expect(create.mock.calls[1][0].messages.at(-1).content[0]).toMatchObject({ is_error: true });
  });

  it("取引先の登録は OK を押すまで入らない。OK のあとで入る", async () => {
    create.mockResolvedValueOnce(toolUse("t1", "register_customer", { name: "テスト食堂", channel: "phone" })).mockResolvedValueOnce(final("OK を押すと登録します"));
    const a = await runAgent({ ...base, role: "事務", message: "テスト食堂を取引先に登録して" });
    expect(a.pending).toHaveLength(1);
    const names = async () => (await listMaster<{ id: string; name: string }>("customers")).map((c) => c.name);
    expect(await names()).not.toContain("テスト食堂");
    await expect(confirmPending(a.pending![0].id, "工場", "もりた")).rejects.toThrow(/役割/);
    expect(await confirmPending(a.pending![0].id, "事務", "たなか")).toMatch(/登録しました/);
    expect(await names()).toContain("テスト食堂");
    await expect(confirmPending(a.pending![0].id, "事務", "たなか")).rejects.toThrow(/もう実行/);
  });

  it("画面のボタンは、知っている画面で、その役割で開ける所だけ", async () => {
    create
      .mockResolvedValueOnce({ stop_reason: "tool_use", content: [
        { type: "tool_use", id: "a", name: "open_page", input: { href: "/settings/staff", label: "スタッフ" } },
        { type: "tool_use", id: "b", name: "open_page", input: { href: "/plan?date=2026-11-06", label: "計画" } },
        { type: "tool_use", id: "c", name: "open_page", input: { href: "https://example.com", label: "外" } },
      ] })
      .mockResolvedValueOnce(final("どうぞ"));
    const a = await runAgent({ ...base, role: "工場", message: "計画を見たい" });
    expect(a.links?.map((l) => l.href)).toEqual(["/plan?date=2026-11-06"]);
  });
});
