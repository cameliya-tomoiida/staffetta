import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/sqlite";
import { getSheet, listSheets, recordsOf, saveRecord } from "@/lib/hygiene/store";
import { getRecordAlarmSettings, missingReport, recordAlertCandidates, saveRecordAlarms } from "../store";
import { kvSet } from "@/lib/db/sqlite";

const at = (d: string, hm: string) => new Date(`${d}T${hm}:00+09:00`).toISOString();

describe("記録のアラームの保存と判定元（(36) A）", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM kv WHERE key IN ('hygiene_sheets', 'record_alarms', 'factory_holidays')");
    recordsOf("2000-01"); // 表を作る
    getDb().exec("DELETE FROM hygiene_records");
    // 製品カードは見ない（このテストは衛生のシートだけ）
    kvSet("record_alarms", { graceMin: 30, submitDay: 5, cards: false });
  });

  it("時刻・締めを保存する。形が違う時刻・温度の回数より多い時刻は止める", () => {
    saveRecordAlarms({ graceMin: 45, submitDay: 3, cards: false }, [{ id: "temp-storage", times: "8:30、14:00", off: false, graceMin: 20 }]);
    expect(getSheet("temp-storage")?.timing).toEqual({ times: ["08:30", "14:00"], graceMin: 20 });
    expect(getRecordAlarmSettings()).toEqual({ graceMin: 45, submitDay: 3, cards: false });
    expect(() => saveRecordAlarms(getRecordAlarmSettings(), [{ id: "temp-storage", times: "9時", off: false }])).toThrow(/形が違います/);
    expect(() => saveRecordAlarms(getRecordAlarmSettings(), [{ id: "temp-storage", times: "8:00, 12:00, 16:00", off: false }])).toThrow(/2つまで/);
  });

  it("時刻が来て書いていないシートを、お知らせの形で出す。書けば消える。先月の提出期限も", async () => {
    // 原料保管庫だけ残す（ほかは出さない）
    for (const s of listSheets()) if (s.id !== "temp-storage") saveRecordAlarms(getRecordAlarmSettings(), [{ id: s.id, times: "", off: true }]);
    const now = at("2026-11-06", "09:40");
    const a = await recordAlertCandidates(now);
    const mine = a.filter((x) => x.dedupeKey.includes("temp-storage"));
    // きのうの 15:00 もこの 24時間の中なので出る（日付つき）
    expect(mine.map((x) => x.title)).toEqual(["11/5 原料保管庫 温度管理表（常温）: 15:00 の温度の記録がまだです", "原料保管庫 温度管理表（常温）: 9:00 の温度の記録がまだです"]);
    expect(mine[1]).toMatchObject({ kind: "record_due", href: "/hygiene/temp-storage?month=2026-11", actions: [{ label: "記録を書く", href: "/hygiene/temp-storage?month=2026-11", primary: true }] });
    // 10月のシートは確認していないので、提出期限のお知らせも出る
    expect(a.some((x) => x.dedupeKey === "record:submit:2026-10")).toBe(true);
    saveRecord("temp-storage", "2026-11", { temps: { "2026-11-05": { am: 21, pm: 23 }, "2026-11-06": { am: 22 } } }, "もりた");
    expect((await recordAlertCandidates(now)).filter((x) => x.dedupeKey.includes("temp-storage"))).toEqual([]);
  });

  it("漏れの一覧（締めを過ぎた分）とシートごとの数", async () => {
    for (const s of listSheets()) if (s.id !== "temp-storage") saveRecordAlarms(getRecordAlarmSettings(), [{ id: s.id, times: "", off: true }]);
    saveRecord("temp-storage", "2026-11", { temps: { "2026-11-02": { am: 20, pm: 21 } } }, "もりた");
    const r = await missingReport("2026-11", at("2026-11-03", "16:00"), { cards: false });
    // 11/1・11/3 は2回とも、11/2 は書いた → 4件（11/3 の 15:00 は 15:30 の締めを過ぎた）
    expect(r.rows.map((x) => `${x.date} ${x.time}`)).toEqual(["2026-11-01 09:00", "2026-11-01 15:00", "2026-11-03 09:00", "2026-11-03 15:00"]);
    expect(r.bySheet).toEqual([{ title: "原料保管庫 温度管理表（常温）", count: 4, href: "/hygiene/temp-storage?month=2026-11" }]);
  });
});
