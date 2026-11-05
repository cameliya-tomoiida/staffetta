// ④ LINE の読み取り（Claude）が一時的に失敗したときの、やり直し・同時呼び出しの制限・それでもだめなときの残し方。
// 例: お客さん2人がほぼ同時に送り、通信が数秒切れて2件とも「Connection error.」になった（⑥の 3106 での試し）。
// Claude は呼ばない（readLineText を差し替える）。待ち時間は 0 にする。
import Anthropic from "@anthropic-ai/sdk";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { LineRead } from "@/lib/channels/line/reader";
import { describeReadError, isRetriableReadError, READ_RETRY_DELAYS_MS, limitConcurrentReads, withReadRetry } from "@/lib/channels/line/read-retry";
import { mem } from "./memdb";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/store", () => import("./memdb"));

const connErr = () => new Anthropic.APIConnectionError({ cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }) });
const READ: LineRead = {
  is_order: true,
  notes: "",
  orders: [{ intent: "new", change_of_order_id: "", delivery_date: "2026-11-09", date_written: "9日", lines: [] }],
};

// 1件ごとに「最初の何回を失敗させるか」を決める（userId で分ける）
const failPlan = new Map<string, number>();
let inFlight = 0;
let maxInFlight = 0;
vi.mock("@/lib/channels/line/reader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/channels/line/reader")>()),
  readLineText: async (text: string) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    const left = failPlan.get(text) ?? 0;
    if (left > 0) {
      failPlan.set(text, left - 1);
      throw connErr();
    }
    return { read: READ, model: "mock" };
  },
}));
// 待ち時間は 0（回数の上限は本物と同じ3回）
vi.mock("@/lib/channels/line/read-retry", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/channels/line/read-retry")>();
  return { ...real, withReadRetry: <T,>(fn: () => Promise<T>, o: Parameters<typeof real.withReadRetry>[1] = {}) => real.withReadRetry(fn, { ...o, delays: o.delays ?? [0, 0, 0] }) };
});

beforeAll(async () => {
  process.env.DEMO_NOW = "2026-11-05T11:30:00+09:00";
  const { setLineAutoSettings } = await import("@/lib/channels/line/auto");
  await setLineAutoSettings({ autoConfirm: false }, "試験");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("やり直しの決まり", () => {
  it("通信の途切れ・時間切れ・混雑・サーバーの失敗はやり直す。断られた・形がちがうはやり直さない", () => {
    expect(isRetriableReadError(connErr())).toBe(true);
    expect(isRetriableReadError(new Anthropic.APIConnectionTimeoutError())).toBe(true);
    for (const s of [429, 500, 529]) expect(isRetriableReadError(Anthropic.APIError.generate(s, {}, "x", new Headers()))).toBe(true);
    expect(isRetriableReadError(Anthropic.APIError.generate(400, {}, "x", new Headers()))).toBe(false);
    expect(isRetriableReadError(new Error("読み取りを断られました"))).toBe(false);
  });

  it("失敗の説明に、下の原因（ECONNRESET など）を添える", () => {
    expect(describeReadError(connErr())).toBe("Connection error.（ECONNRESET）");
    expect(describeReadError(new Error("x"))).toBe("x");
  });

  it("間をあけてやり直し、通ればその値。待つ時間は 5秒→20秒→45秒", async () => {
    const waits: number[] = [];
    let n = 0;
    const r = await withReadRetry(
      async () => {
        if (++n < 4) throw connErr();
        return "ok";
      },
      { delays: READ_RETRY_DELAYS_MS, sleep: async (ms) => void waits.push(ms) },
    );
    expect(r).toEqual({ value: "ok", attempts: 4 });
    expect(READ_RETRY_DELAYS_MS).toEqual([5_000, 20_000, 45_000]);
    expect(waits).toEqual(READ_RETRY_DELAYS_MS);
  });

  it("上限（最初＋3回）でもだめなら、回数をつけてあきらめる。やり直せない失敗はすぐあきらめる", async () => {
    let n = 0;
    await expect(withReadRetry(async () => { n++; throw connErr(); }, { sleep: async () => undefined })).rejects.toMatchObject({ attempts: 4 });
    expect(n).toBe(4);
    n = 0;
    await expect(withReadRetry(async () => { n++; throw new Error("断られました"); }, { sleep: async () => undefined })).rejects.toMatchObject({ attempts: 1 });
    expect(n).toBe(1);
  });

  it("同時に頼むのは2件まで。3件目は前のが終わるのを待つ", async () => {
    let now = 0;
    let peak = 0;
    const job = () => limitConcurrentReads(async () => {
      peak = Math.max(peak, ++now);
      await new Promise((r) => setTimeout(r, 5));
      now--;
    });
    await Promise.all([job(), job(), job(), job(), job()]);
    expect(peak).toBe(2);
  });
});

describe("LINE のトーク注文で", () => {
  it("2人が同時に送り、2件とも最初は通信が切れても、やり直して読み取れる", async () => {
    const o = await import("@/lib/channels/line/orders");
    failPlan.set("同時A", 2);
    failPlan.set("同時B", 1);
    maxInFlight = 0;
    const [a, b] = await Promise.all([
      o.ingestTalkMessage({ messageId: "rtA", userId: "U_demo_rtA", text: "同時A", receivedAt: "2026-11-05T02:30:00.000Z" }),
      o.ingestTalkMessage({ messageId: "rtB", userId: "U_demo_rtB", text: "同時B", receivedAt: "2026-11-05T02:30:01.000Z" }),
    ]);
    const oa = mem.db.orders.find((x) => x.id === a.orders![0].id)!;
    const ob = mem.db.orders.find((x) => x.id === b.orders![0].id)!;
    expect(oa.source.extra).toMatchObject({ readModel: "mock", readAttempts: 3 });
    expect(ob.source.extra).toMatchObject({ readModel: "mock", readAttempts: 2 });
    expect(oa.source.extra?.readError).toBeUndefined();
    expect(oa.deliveryDate).toBe("2026-11-09");
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it("やり直してもだめなら、原文つきの「要確認」で残す（注文は消えない）", async () => {
    const o = await import("@/lib/channels/line/orders");
    failPlan.set("ずっと切れる", 99);
    const r = await o.ingestTalkMessage({ messageId: "rtC", userId: "U_demo_rtC", text: "ずっと切れる", receivedAt: "2026-11-05T02:31:00.000Z" });
    const oc = mem.db.orders.find((x) => x.id === r.orders![0].id)!;
    expect(oc.status).toBe("needs_review");
    expect(oc.source.rawText).toBe("ずっと切れる");
    expect(oc.source.extra).toMatchObject({ readError: "Connection error.（ECONNRESET）", readAttempts: 4 });
    expect(failPlan.get("ずっと切れる")).toBe(95); // 4回で止めた
  });
});
