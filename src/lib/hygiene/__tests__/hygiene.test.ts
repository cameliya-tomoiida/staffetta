// ⑦(21) 衛生管理のチェックシート: 月の日付・週・記入する日、点検の計画（○）、温度の範囲、困りごと、保存と責任者の確認、マニュアル。
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_SHEETS, isPlanned, monthDays, outOfRange, runDays, sheetProblems, type SheetDef } from "../sheets";

vi.mock("server-only", () => ({}));
beforeAll(() => {
  process.env.HUB_DB_PATH = ":memory:";
});

describe("月の日付", () => {
  it("2026年11月は 1日が日曜・30日まで。週は月曜はじまり", () => {
    const d = monthDays("2026-11");
    expect(d).toHaveLength(30);
    expect(d[0]).toMatchObject({ date: "2026-11-01", weekday: 0, week: 1 });
    expect(d[1]).toMatchObject({ date: "2026-11-02", weekday: 1, week: 2 });
    expect(d.at(-1)).toMatchObject({ date: "2026-11-30", weekday: 1, week: 6 });
  });
  it("記入する日は、曜日と休業日で絞る", () => {
    const r = runDays({ weekdays: [1, 2, 3, 4, 5] }, "2026-11", ["2026-11-03"]);
    expect(r.map((x) => x.d)).not.toContain(3);
    expect(r.map((x) => x.d)).not.toContain(1);
    expect(r).toHaveLength(20);
  });
});

describe("点検の計画（○）", () => {
  const run = runDays({ weekdays: [1, 2, 3, 4, 5] }, "2026-11");
  const days = monthDays("2026-11");
  const planned = (item: Parameters<typeof isPlanned>[0]) => days.filter((d) => isPlanned(item, d, run)).map((d) => d.d);
  it("週2＝月曜と木曜", () => {
    expect(planned({ id: "f", name: "f", freq: "twice" })).toEqual([2, 5, 9, 12, 16, 19, 23, 26, 30]);
  });
  it("毎日＝記入する日ぜんぶ、週1＝水曜、2週に1＝偶数週の決めた曜日、月1＝最初の営業日", () => {
    expect(planned({ id: "a", name: "a", freq: "daily" })).toHaveLength(21);
    expect(planned({ id: "b", name: "b", freq: "weekly" })).toEqual([4, 11, 18, 25]);
    expect(planned({ id: "c", name: "c", freq: "biweekly", weekday: 5 })).toEqual([6, 20]);
    expect(planned({ id: "d", name: "d", freq: "monthly" })).toEqual([2]);
    expect(planned({ id: "e", name: "e", freq: "monthly", monthDay: 15 })).toEqual([16]); // 15日は日曜なので次の営業日
  });
  it("週1の曜日が休みなら、その週の最後の記入日にずらす", () => {
    const r2 = runDays({ weekdays: [1, 2, 3, 4, 5] }, "2026-11", ["2026-11-11"]);
    expect(days.filter((d) => isPlanned({ id: "b", name: "b", freq: "weekly" }, d, r2)).map((d) => d.d)).toEqual([4, 13, 18, 25]);
  });
});

describe("温度と困りごと", () => {
  const oven: SheetDef = { id: "t", title: "窯", kind: "temp", weekdays: [1, 2, 3, 4, 5], temp: { unit: "℃", set: 450, min: 440, max: 446, perDay: 2 } };
  it("管理範囲の外", () => {
    expect(outOfRange(oven.temp, 443)).toBe(false);
    expect(outOfRange(oven.temp, 447)).toBe(true);
    expect(outOfRange(oven.temp, undefined)).toBe(false);
  });
  it("範囲の外で措置が無い・過ぎた日の記入もれ・清掃のしていない計画・金属検出の×に措置なし", () => {
    const p = sheetProblems(oven, { temps: { "2026-11-02": { am: 450, pm: 443 } } }, "2026-11", "2026-11-04");
    expect(p).toEqual(["2日: 管理範囲の外です。異常時の措置を書いてください", "3日: 記入がありません"]);
    const clean: SheetDef = { id: "c", title: "c", kind: "clean", weekdays: [1, 2, 3, 4, 5], items: [{ id: "x", name: "床", freq: "daily" }] };
    expect(sheetProblems(clean, { done: { "x|2026-11-02": "見本" } }, "2026-11", "2026-11-04")[0]).toMatch(/1件.*3日 床/);
    const metal: SheetDef = { id: "m", title: "金属", kind: "log", columns: [{ key: "beforeFe", label: "Fe", type: "okng" }, { key: "action", label: "措置", type: "text" }] };
    expect(sheetProblems(metal, { rows: [{ beforeFe: "ng" }] }, "2026-11", "2026-11-04")).toEqual(["1行目: ×があります。措置を書いてください"]);
  });
  it("はじめのシート: 会社名・取引先名なし／製品が通る道（焼成・急速冷凍・金属・製造日報）は製品カードへ／売店なし・米飯あり／温度は全曜日", () => {
    expect(JSON.stringify(DEFAULT_SHEETS)).not.toMatch(/自社|株式会社|売店/);
    const ids = DEFAULT_SHEETS.map((s) => s.id);
    expect(ids).not.toContain("temp-pizza-oven");
    expect(ids).not.toContain("log-metal");
    expect(ids).toContain("clean-rice");
    for (const s of DEFAULT_SHEETS.filter((x) => x.kind === "temp")) expect(s.weekdays ?? []).toEqual([]);
    expect(DEFAULT_SHEETS.find((s) => s.id === "clean-baking")!.items!.some((x) => x.freq === "twice")).toBe(true);
  });
});

describe("保存", () => {
  it("記録の保存 → 責任者が確認すると直せない → 外すと直せる。確認は記録の保存では変えられない", async () => {
    const s = await import("../store");
    s.saveRecord("temp-storage", "2026-11", { temps: { "2026-11-02": { am: 23 } }, approvedBy: "ずる" }, "見本");
    expect(s.getRecord("temp-storage", "2026-11").rec).toEqual({ temps: { "2026-11-02": { am: 23 } } });
    s.approveRecord("temp-storage", "2026-11", "責任者");
    expect(() => s.saveRecord("temp-storage", "2026-11", { temps: {} }, "見本")).toThrow(/確認を外して/);
    s.approveRecord("temp-storage", "2026-11", "");
    s.saveRecord("temp-storage", "2026-11", { temps: { "2026-11-02": { am: 24 } } }, "見本");
    expect(s.recordsOf("2026-11").get("temp-storage")?.temps?.["2026-11-02"]?.am).toBe(24);
  });
  it("シートの項目を直せる・はじめに戻せる", async () => {
    const s = await import("../store");
    const cur = s.getSheet("check-last-out")!;
    s.saveSheet({ ...cur, items: [...cur.items!, { id: "s99", name: "見本のスイッチ" }] });
    expect(s.getSheet("check-last-out")!.items!.at(-1)?.name).toBe("見本のスイッチ");
    s.resetSheets();
    expect(s.getSheet("check-last-out")!.items!.some((x) => x.id === "s99")).toBe(false);
  });
  it("マニュアルの登録・読み出し・消す（種類と大きさの確かめ）", async () => {
    const s = await import("../store");
    expect(() => s.addManual({ name: "x", category: "", fileName: "a.exe", mime: "", bytes: new Uint8Array(1) }, "見本")).toThrow(/PDF/);
    const m = s.addManual({ name: "手洗いの手順", category: "従業員の衛生", fileName: "tearai.pdf", mime: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.4 見本") }, "見本");
    expect(s.listManuals().map((x) => x.name)).toEqual(["手洗いの手順"]);
    expect(new TextDecoder().decode(s.readManual(m.id)!.bytes)).toBe("%PDF-1.4 見本");
    s.deleteManual(m.id);
    expect(s.listManuals()).toEqual([]);
  });
});
