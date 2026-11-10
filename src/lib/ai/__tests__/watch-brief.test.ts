import { beforeEach, describe, expect, it, vi } from "vitest";

const parse = vi.fn();
vi.mock("../client", () => ({ aiClient: () => ({ beta: { messages: { parse } } }) }));

import { findUnusual, reasonsFor } from "../watch";
import { briefingFor, ruleBriefing, type BriefFacts } from "../briefing";
import { setAiSettings } from "../settings";
import { getDb } from "@/lib/db/sqlite";
import type { Order } from "@/data/types";

const o = (id: string, date: string, q: number, status: Order["status"] = "confirmed", productId = "P01"): Order => ({
  id, intent: "new", customerId: "C01", deliveryDate: date, status, createdAt: `${date}T00:00:00+09:00`, edits: [],
  source: { channel: "fax", refs: [], receivedAt: `${date}T00:00:00+09:00` },
  lines: [{ id: `${id}-0`, productId, quantity: q, unit: "個", piecesPerUnit: 1, pieces: q, confidence: 1, edits: [] }],
});
const history = [o("H1", "2026-10-26", 60), o("H2", "2026-10-28", 55), o("H3", "2026-10-30", 60), o("H4", "2026-11-02", 65)];

describe("いつもと違う注文の見張り", () => {
  it("いつもの数（中央値）と比べて、3倍以上・3分の1以下・桁のまちがいを拾う。ふつうの数・過去が少ないものは拾わない", () => {
    const list = findUnusual([...history, o("A", "2026-11-09", 600, "needs_review"), o("B", "2026-11-10", 15), o("C", "2026-11-11", 70), o("D", "2026-11-12", 200), o("E", "2026-11-13", 50, "confirmed", "P02")], "2026-11-06");
    expect(list.map((u) => [u.orderId, u.kind, u.usual])).toEqual([["A", "桁", 60], ["B", "少ない", 60], ["D", "多い", 60]]);
    expect(list[0].times).toBe(10);
    // 過去の注文（今日より前）と取り消しは見ない
    expect(findUnusual([...history, o("X", "2026-11-01", 600), o("Y", "2026-11-09", 600, "cancelled")], "2026-11-06")).toEqual([]);
  });

  beforeEach(() => {
    getDb().exec("DELETE FROM kv WHERE key LIKE 'ai_%'");
    setAiSettings({ apiKey: "sk-ant-test0123456789abcdefghijklmnop" }, "はやし");
    parse.mockReset();
  });

  it("理由は AI に1回だけ聞いて覚える。AI が使えなければ決まりの文", async () => {
    const [u] = findUnusual([...history, o("A", "2026-11-09", 600)], "2026-11-06").map((x) => ({ ...x, customerName: "ひまわり保育園", productName: "バターロール" }));
    parse.mockResolvedValueOnce({ parsed_output: { reasons: [{ key: u.key, reason: "いつもの10倍です。60の打ちまちがいか確かめましょう" }] } });
    expect((await reasonsFor([u])).get(u.key)).toMatch(/10倍/);
    expect((await reasonsFor([u])).get(u.key)).toMatch(/10倍/);
    expect(parse).toHaveBeenCalledTimes(1);
    getDb().exec("DELETE FROM kv WHERE key = 'ai_watch_reasons'");
    parse.mockRejectedValueOnce(new Error("上限"));
    expect((await reasonsFor([u])).get(u.key)).toMatch(/桁の打ちまちがい/);
  });
});

describe("朝の今日の要点", () => {
  const f: BriefFacts = { date: "2026-11-06", orders: 18, sales: 410976, grossRate: 0.555, review: 7, fax: 5, purchaseDraft: 3, overdue: 3, lowStock: 2, urgent: 0, lines: [{ name: "ピザライン", pieces: 1650, unit: "枚", room: 350 }], alerts: [] };

  beforeEach(() => {
    getDb().exec("DELETE FROM kv WHERE key LIKE 'ai_%'");
    parse.mockReset();
  });

  it("数字だけの3行（AI が使えないとき）", () => {
    expect(ruleBriefing(f)).toEqual([
      "11/6 納品は 18 件・売上 410,976円（粗利 55.5%）。",
      "まず 要確認の注文 7 件・FAX 5 枚・発注書の承認 3 枚 を片づけましょう。",
      "気になること: 締めを過ぎた発注書 3 枚・発注が必要な材料 2 件。",
    ]);
  });

  it("その日に1回だけ作って覚える。作り直すと作り直す。キーが無ければ数字から", async () => {
    setAiSettings({ apiKey: "sk-ant-test0123456789abcdefghijklmnop" }, "はやし");
    parse.mockResolvedValue({ parsed_output: { lines: ["一", "二", "三", "四"] } });
    const a = await briefingFor(f, "2026-11-06");
    expect(a).toMatchObject({ by: "AI", lines: ["一", "二", "三"] });
    await briefingFor(f, "2026-11-06");
    expect(parse).toHaveBeenCalledTimes(1);
    await briefingFor(f, "2026-11-06", true);
    expect(parse).toHaveBeenCalledTimes(2);
    setAiSettings({ apiKey: null }, "はやし");
    const env = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect((await briefingFor(f, "2026-11-07"))?.by).toBe("数字");
    if (env) process.env.ANTHROPIC_API_KEY = env;
  });
});
