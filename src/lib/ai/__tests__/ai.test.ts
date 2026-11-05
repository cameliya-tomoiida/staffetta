import { beforeEach, describe, expect, it, vi } from "vitest";

// Claude は呼ばない（答えを決めておく）
const parse = vi.fn();
vi.mock("../client", () => ({ aiClient: () => ({ beta: { messages: { parse } } }) }));

import { askAi, chatLog } from "../chat";
import { assertBudget, costUsd, getAiSettings, monthUsage, publicAiSettings, recordUsage, setAiSettings } from "../settings";
import { getDb } from "@/lib/db/sqlite";

const T = Date.parse("2026-11-06T10:00:00+09:00");

describe("AI の設定と使った量", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM kv WHERE key LIKE 'ai_%'");
  });

  it("キーは伏せ字で出す。形が違うキーは入れない。空にすると .env のキーに戻す", () => {
    expect(() => setAiSettings({ apiKey: "abc" }, "はやし")).toThrow(/形が違います/);
    setAiSettings({ apiKey: "sk-ant-test0123456789abcdefghijklmnop" }, "はやし");
    const p = publicAiSettings();
    expect(p.keySource).toBe("settings");
    expect(p.keyMasked).toBe("sk-ant-…mnop");
    expect(JSON.stringify(p)).not.toContain("0123456789");
    setAiSettings({ apiKey: null }, "はやし");
    expect(getAiSettings().apiKey).toBeUndefined();
    expect(() => setAiSettings({ monthlyLimitYen: 100 }, "")).toThrow();
  });

  it("使った量を月・機能ごとに足す。金額は 100万トークンあたりの値段から", () => {
    expect(costUsd("claude-opus-5-5", 1_000_000, 100_000)).toBeCloseTo(4 + 2);
    expect(costUsd("claude-sonnet-5-5", 500_000, 0)).toBeCloseTo(1);
    recordUsage("FAX の読み取り", "claude-opus-5-5", { input_tokens: 10_000, output_tokens: 2_000, cache_read_input_tokens: 1_000 }, T);
    recordUsage("FAX の読み取り", "claude-opus-5-5", { input_tokens: 10_000, output_tokens: 2_000 }, T);
    recordUsage("AI 相談チャット", "claude-sonnet-5-5", { input_tokens: 4_000, output_tokens: 500 }, T);
    const m = monthUsage("2026-11");
    expect(m.calls).toBe(3);
    expect(m.byFeature["FAX の読み取り"]).toMatchObject({ calls: 2, input: 21_000, output: 4_000 });
    expect(m.usd).toBeCloseTo(costUsd("claude-opus-5-5", 21_000, 4_000) + costUsd("claude-sonnet-5-5", 4_000, 500));
  });

  it("月の上限に届いたら止める（上限なしなら止めない）", () => {
    recordUsage("FAX の読み取り", "claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 0 }, T); // $4 = 600円
    expect(() => assertBudget(T)).not.toThrow();
    setAiSettings({ monthlyLimitYen: 500, yenPerDollar: 150 }, "はやし");
    expect(() => assertBudget(T)).toThrow(/上限（500円）/);
    setAiSettings({ monthlyLimitYen: 1000 }, "はやし");
    expect(() => assertBudget(T)).not.toThrow();
  });
});

describe("AI 相談チャット", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM kv WHERE key LIKE 'ai_%'");
    setAiSettings({ apiKey: "sk-ant-test0123456789abcdefghijklmnop" }, "はやし");
    parse.mockReset();
  });

  it("答えのボタンは、知っている画面で、その役割で開ける所だけ。会話は人ごとに残す", async () => {
    parse.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: {
        answer: "製造計画の画面で見られます。",
        links: [
          { label: "製造計画を開く", href: "/plan?date=2026-11-06" },
          { label: "設定を開く", href: "/settings/features" },
          { label: "外のサイト", href: "https://example.com" },
          { label: "知らない画面", href: "/secret" },
        ],
      },
    });
    const a = await askAi({ userKey: "ST05", role: "工場", name: "もりた", question: "明日の生地は？", path: "/home", pageText: "ホーム" });
    expect(a.links?.map((l) => l.href)).toEqual(["/plan?date=2026-11-06"]);
    const b = await askAi({ userKey: "ST06", role: "管理者", name: "はやし", question: "機能を止めたい", path: "/", pageText: "" });
    expect(b.links?.map((l) => l.href)).toEqual(["/plan?date=2026-11-06", "/settings/features"]);
    expect(chatLog("ST05").map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(chatLog("ST06")).toHaveLength(2);
    // 工場の人には、管理者向けの設定の中身（機能の ON/OFF）を渡さない
    const sysFactory = JSON.stringify(parse.mock.calls[0][0].system);
    const sysAdmin = JSON.stringify(parse.mock.calls[1][0].system);
    expect(sysFactory).not.toContain("今の機能の ON/OFF");
    expect(sysAdmin).toContain("今の機能の ON/OFF");
    expect(sysFactory).not.toContain("/settings/staff");
  });

  it("キーが無いとき・空の質問は止める", async () => {
    setAiSettings({ apiKey: null }, "はやし");
    const env = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    await expect(askAi({ userKey: "lan", role: "管理者", name: "", question: "?", path: "/", pageText: "" })).rejects.toThrow(/AI の設定がまだ/);
    if (env) process.env.ANTHROPIC_API_KEY = env;
    setAiSettings({ apiKey: "sk-ant-test0123456789abcdefghijklmnop" }, "はやし");
    await expect(askAi({ userKey: "lan", role: "管理者", name: "", question: "  ", path: "/", pageText: "" })).rejects.toThrow(/入れてください/);
  });
});
