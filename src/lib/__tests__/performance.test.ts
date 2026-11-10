// 速さ: 11/6 のデモの計算（DB のマスタを読む ＋ 通し計算）が 1秒以内。
// 保存先はテスト用のメモリ（HUB_DB_PATH=:memory:、vitest.config.mts）。本物の data/hub.sqlite は触らない。
import { describe, expect, it } from "vitest";
import { runPipeline } from "../pipeline";
import { DEMO_DATE, demoOrders } from "@/data/demo-orders";
import type { Order } from "@/data/types";

describe("計算の速さ", () => {
  it("マスタを DB から読んで 11/6 を計算するまで 1秒以内（2回目以降）", async () => {
    const { seedSampleMasters, loadMasters } = await import("../masters/seed-db");
    await seedSampleMasters();
    runPipeline(demoOrders, DEMO_DATE, { masters: await loadMasters() }); // 1回目はプログラムの読み込みを含むので外す
    const t = performance.now();
    const masters = await loadMasters();
    const r = runPipeline(demoOrders, DEMO_DATE, { masters });
    const ms = performance.now() - t;
    expect(r.production.doughs.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(1000);
  });

  it("注文が1か月分（約600件）あっても 1秒以内", () => {
    const many: Order[] = [];
    for (let d = 0; d < 30; d++)
      for (const o of demoOrders) many.push({ ...o, id: `${o.id}-${d}`, deliveryDate: new Date(Date.UTC(2026, 10, 1 + d)).toISOString().slice(0, 10) });
    runPipeline(many, DEMO_DATE);
    const t = performance.now();
    runPipeline(many, DEMO_DATE);
    expect(performance.now() - t).toBeLessThan(1000);
  });
});

// ⑧ 大量データの測定（docs/benchmark.md）で見つけて直した所: 取引先が多いと集計が遅かった（取引先を毎回先頭から探していた）
describe("大量の注文の集計（⑧）", () => {
  it("明細 10万行・取引先 5,000社でも 3秒以内で、数は正しい", async () => {
    const { aggregateOrders } = await import("../aggregate");
    const base = demoOrders.find((o) => o.lines.length > 0)!;
    const pids = [...new Set(demoOrders.flatMap((o) => o.lines.map((l) => l.productId)).filter(Boolean))].slice(0, 10);
    const many: Order[] = [];
    let want = 0;
    for (let i = 0; i < 10_000; i++) {
      many.push({
        ...base, id: `PERF${i}`, customerId: `PC${i % 5000}`, status: "confirmed", intent: undefined, deliveryDate: "2026-11-06",
        lines: pids.map((p, k) => ({ ...base.lines[0], id: `PERF${i}-${k}`, productId: p, quantity: 2, piecesPerUnit: 1, pieces: 2 })),
      });
      want += pids.length * 2;
    }
    const t = performance.now();
    const [day] = aggregateOrders(many);
    const ms = performance.now() - t;
    expect(day.products.reduce((a, p) => a + p.pieces, 0)).toBe(want);
    const first = day.products[0];
    expect(first.customers).toHaveLength(5000);
    expect(first.customers[0]).toMatchObject({ customerId: "PC0", pieces: 4, orderIds: ["PERF0", "PERF5000"] });
    expect(ms).toBeLessThan(3000);
  });
});
