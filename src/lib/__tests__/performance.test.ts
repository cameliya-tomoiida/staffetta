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
