import { beforeEach, describe, expect, it } from "vitest";

// next/server の connection() は真似しない（5分ごとの判定はリクエストの外で動くので、呼んでいたら落ちることを確かめる）

import { preparePlanIfDue } from "../plan-prepare";
import { listAlerts } from "../db/alerts-store";
import { resetToDemo } from "../db/hub-store";
import { getDb, kvGet } from "../db/sqlite";
import { setFlag } from "../settings/features";

describe("C1: 夕方に翌日の製造計画を作る", () => {
  beforeEach(async () => {
    await resetToDemo();
    getDb().exec("DELETE FROM kv WHERE key LIKE 'plan_prepared_%'");
    setFlag("plan_auto_prepare", true, "テスト");
    setFlag("plan_auto_print", false, "テスト");
  });

  it("17:00 前は作らない。過ぎたら翌日分を1回だけ作り、お知らせを出す", async () => {
    expect(await preparePlanIfDue("2026-11-05T16:59:00+09:00")).toBeUndefined();
    const r = await preparePlanIfDue("2026-11-05T17:05:00+09:00");
    expect(r?.date).toBe("2026-11-06");
    expect(kvGet("plan_prepared_2026-11-06")).toBeTruthy();
    expect(listAlerts().find((a) => a.dedupeKey === "plan_prepared:2026-11-06")?.href).toBe("/plan?date=2026-11-06");
    expect(await preparePlanIfDue("2026-11-05T17:10:00+09:00")).toBeUndefined(); // 2回目は作らない
  });

  it("機能を OFF にすると作らない。印刷を ON にしても、設定が無いので記録だけ", async () => {
    setFlag("plan_auto_prepare", false, "テスト");
    expect(await preparePlanIfDue("2026-11-05T18:00:00+09:00")).toBeUndefined();
    setFlag("plan_auto_prepare", true, "テスト");
    setFlag("plan_auto_print", true, "テスト");
    const r = await preparePlanIfDue("2026-11-05T18:00:00+09:00");
    expect(r?.printed).toBe(false);
    expect(r?.printNote).toContain("印刷の設定");
  });
});
