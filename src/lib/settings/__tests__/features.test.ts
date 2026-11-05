import { beforeEach, describe, expect, it } from "vitest";
import { FEATURES, flagLog, hiddenMenuHrefs, isOn, listFlags, setFlag } from "../features";
import { getDb } from "@/lib/db/sqlite";

describe("機能の ON/OFF", () => {
  beforeEach(() => {
    getDb().exec("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL); DELETE FROM kv WHERE key LIKE 'feature_flags%'");
  });

  it("key は重ならず、dependsOn は一覧にある key", () => {
    const keys = FEATURES.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of FEATURES) if ("dependsOn" in f && f.dependsOn) expect(keys).toContain(f.dependsOn);
  });

  it("既定: 機能は全部「使う」、自動は FAX と LINE の自動確定と翌日の計画を作るだけ ON（送信・承認・印刷の自動は OFF）", () => {
    for (const f of FEATURES) if (f.kind === "feature") expect(isOn(f.key)).toBe(true);
    const autoOn = FEATURES.filter((f) => f.kind === "auto" && isOn(f.key)).map((f) => f.key).sort();
    expect(autoOn).toEqual(["fax_auto_confirm", "line_auto_confirm", "plan_auto_prepare"]);
  });

  it("切り替えると誰がいつ変えたかが残り、dependsOn が OFF なら子も OFF、メニューも隠れる", () => {
    setFlag("line_orders", false, "はやし");
    expect(isOn("line_orders")).toBe(false);
    expect(isOn("line_auto_confirm")).toBe(false); // 親が OFF
    const row = listFlags().find((f) => f.key === "line_auto_confirm")!;
    expect(row.on).toBe(true); // 自分のスイッチは ON のまま
    expect(row.effective).toBe(false);
    expect(hiddenMenuHrefs()).toContain("/line");
    expect(flagLog()[0]).toMatchObject({ key: "line_orders", on: false, who: "はやし" });
    expect(listFlags().find((f) => f.key === "line_orders")?.changedBy).toBe("はやし");

    setFlag("line_orders", true, "はやし");
    expect(isOn("line_auto_confirm")).toBe(true);
    expect(hiddenMenuHrefs()).not.toContain("/line");
  });

  it("一覧に無い key・名前なしは変えられない", () => {
    expect(() => setFlag("nai" as never, true, "x")).toThrow();
    expect(() => setFlag("stock", false, "")).toThrow();
  });
});
