// ⑧ A 記録の漏れ・時間のアラーム（架空のシートだけ）
import { describe, expect, it } from "vitest";
import { alarmOf, DEFAULT_ALARM_SETTINGS, gapAlerts, recordGaps, type AlarmSettings } from "../alarms";
import type { SheetDef } from "../../hygiene/sheets";

const temp: SheetDef = { id: "t1", title: "保管庫の温度", kind: "temp", temp: { unit: "℃", max: 28, perDay: 2 } };
const clean: SheetDef = { id: "c1", title: "床の清掃", kind: "clean", items: [{ id: "i1", name: "床", freq: "daily" }, { id: "i2", name: "排水溝", freq: "daily" }] };
const S: AlarmSettings = DEFAULT_ALARM_SETTINGS;

describe("記録の時刻・締め", () => {
  it("決めていないシートは、種類から（温度は 9:00・15:00、点検は 17:00）", () => {
    expect(alarmOf(temp, S)).toMatchObject({ times: ["09:00", "15:00"], graceMin: 60, submitDay: 5 });
    expect(alarmOf(clean, S).times).toEqual(["17:00"]);
    expect(alarmOf(temp, { ...S, sheets: { t1: { times: ["10:00", "bad", "08:30"] } } }).times).toEqual(["08:30", "10:00"]);
  });

  it("時刻が来たら due、締めを過ぎたら late、時刻の前は出さない。過ぎた日は late", () => {
    const sh = [{ def: temp, rec: { temps: { "2026-11-02": { am: 20, pm: 21 }, "2026-11-03": { am: 20 } } } }];
    const at = (t: string) => recordGaps(`2026-11-03T${t}`, sh, S);
    // 11/1(日) はシートの曜日の決まりが無いので回る日。11/1 は書いていない → late 2件
    expect(at("08:00").filter((g) => g.date === "2026-11-03")).toEqual([]);
    expect(at("15:10").filter((g) => g.date === "2026-11-03").map((g) => [g.time, g.state])).toEqual([["15:00", "due"]]);
    expect(at("16:30").filter((g) => g.date === "2026-11-03").map((g) => [g.time, g.state])).toEqual([["15:00", "late"]]);
    const past = at("08:00").filter((g) => g.date === "2026-11-01");
    expect(past.map((g) => g.state)).toEqual(["late", "late"]);
    expect(past[0].text).toBe("09:00 の温度の記録がまだです");
  });

  it("点検・チェックは、その日にする項目が残っていたら", () => {
    const g = recordGaps("2026-11-03T17:30", [{ def: clean, rec: { done: { "i1|2026-11-03": "見本" } } }], S, [], { onlyToday: true });
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ kind: "clean", state: "due", text: "17:00 までの「排水溝」がまだです" });
  });

  it("提出期限: 前の月を書いたのに責任者の確認が無ければ、期限までは due・過ぎたら late", () => {
    const sh = [{ def: temp, rec: {}, prev: { temps: { "2026-10-31": { am: 20 } } } }];
    const a = recordGaps("2026-11-05T10:00", sh, S).filter((x) => x.kind === "approve");
    expect(a[0]).toMatchObject({ state: "due", text: "10月分の責任者の確認がまだです（提出期限 5日）" });
    expect(recordGaps("2026-11-06T10:00", sh, S).find((x) => x.kind === "approve")?.state).toBe("late");
    expect(recordGaps("2026-11-06T10:00", [{ ...sh[0], prev: { ...sh[0].prev, approvedBy: "見本" } }], S).find((x) => x.kind === "approve")).toBeUndefined();
  });

  it("切ったシートは見ない", () => {
    expect(recordGaps("2026-11-03T20:00", [{ def: temp }], { ...S, sheets: { t1: { on: false } } })).toEqual([]);
  });
});

describe("金属検査は流すたびに", () => {
  it("流す回数ぶんの ○× が無ければ「あと◯回分」", () => {
    const card = { key: "DG01", name: "ロール生地", date: "2026-11-03", runs: 3, href: "/cards/2026-11-04/DG01", items: [{ productId: "P1", name: "見本ロール", metal: ["ok", undefined, ""] }, { productId: "P2", name: "見本パン", metal: ["ok", "ng", "ok"] }] };
    expect(recordGaps("2026-11-03T16:00", [], S, [card])).toEqual([]);
    const g = recordGaps("2026-11-03T17:05", [], S, [card]);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ kind: "metal", state: "due", text: "見本ロールの金属検査があと2回分ありません（流す回数 3回）" });
  });
});

describe("お知らせの形", () => {
  it("今日の分は1件ずつ（締めを期限に）、過ぎた日はシートごとに1件", () => {
    const sh = [{ def: temp, rec: {} }];
    const a = gapAlerts(recordGaps("2026-11-03T09:40", sh, S), "2026-11-03");
    expect(a.filter((x) => x.dedupeKey.startsWith("record:"))).toEqual([
      expect.objectContaining({ level: "warn", title: "保管庫の温度: 09:00 の温度の記録がまだです", dueAt: "2026-11-03T10:00:00+09:00" }),
    ]);
    const past = a.filter((x) => x.dedupeKey.startsWith("record-past:"));
    expect(past).toHaveLength(1);
    expect(past[0]).toMatchObject({ level: "danger", href: "/hygiene/missing" });
    expect(past[0].title).toContain("書いていない所が 4件");
  });
});

describe("毎時の記録（記録する時刻の数だけ欄）", () => {
  it("3つ目からの時刻は vals に入り、漏れも時刻ごとに見る", async () => {
    const { withSlot, slotVal, allVals, tempSlots } = await import("../../hygiene/sheets");
    let e = withSlot(undefined, 0, 20);
    e = withSlot(e, 3, 22);
    expect([slotVal(e, 0), slotVal(e, 1), slotVal(e, 2), slotVal(e, 3)]).toEqual([20, undefined, undefined, 22]);
    expect(allVals(e)).toEqual([20, 22]);
    expect(withSlot(e, 0, undefined).am).toBeUndefined();
    expect(tempSlots({ perDay: 2 })).toEqual(["①午前", "②午後"]);
    expect(tempSlots({ perDay: 1 }, ["08:00", "09:00", "10:00"])).toEqual(["08:00", "09:00", "10:00"]);
    const hourly: AlarmSettings = { ...S, sheets: { t1: { times: ["08:00", "09:00", "10:00", "11:00"], graceMin: 30 } } };
    const g = recordGaps("2026-11-03T11:10", [{ def: temp, rec: { temps: { "2026-11-03": e } } }], hourly, [], { onlyToday: true });
    expect(g.map((x) => [x.time, x.state])).toEqual([["09:00", "late"], ["10:00", "late"]]); // 11:00 は書いてある
  });
});
