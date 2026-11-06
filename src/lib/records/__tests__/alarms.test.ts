import { describe, expect, it } from "vitest";
import {
  cardSlots, hygieneSlots, metalRunsDone, metalRunsNeeded, missingRows, monthHygieneSlots, normTime, parsePlanned, slotAlerts, submitAlerts, timesOf,
} from "../alarms";
import type { SheetDef } from "@/lib/hygiene/sheets";
import type { CardBase } from "@/lib/cards/card";

const temp: SheetDef = { id: "t1", title: "保管冷凍庫 温度管理表", kind: "temp", temp: { unit: "℃", max: -18, perDay: 2 } };
const check: SheetDef = { id: "c1", title: "備品管理表", kind: "check", items: [{ id: "a", name: "ヘラ" }, { id: "b", name: "トング" }] };
const clean: SheetDef = { id: "k1", title: "点検清掃", kind: "clean", items: [{ id: "x", name: "床", freq: "daily" }, { id: "y", name: "窓", freq: "weekly", weekday: 3 }] };
const at = (d: string, hm: string) => new Date(`${d}T${hm}:00+09:00`).toISOString();

describe("記録の時刻", () => {
  it("決めていなければ形から（温度は1日の回数ぶん・チェックと点検は 17:00・記録の表は無し）。決めた時刻は並べ直す", () => {
    expect(timesOf(temp)).toEqual(["09:00", "15:00"]);
    expect(timesOf({ ...temp, temp: { unit: "℃", perDay: 1 } })).toEqual(["09:00"]);
    expect(timesOf(check)).toEqual(["17:00"]);
    expect(timesOf({ id: "l", title: "l", kind: "log" })).toEqual([]);
    expect(timesOf({ ...temp, timing: { times: ["14:00", "8:30", "20:00"] } })).toEqual(["08:30", "14:00"]);
    expect(timesOf({ ...check, timing: { off: true } })).toEqual([]);
    expect(normTime("9：05")).toBe("09:05");
    expect(normTime("25:00")).toBeUndefined();
  });

  it("温度: 1回目は午前の欄・2回目は午後の欄で、書いたかを見る", () => {
    const s = hygieneSlots(temp, { temps: { "2026-11-06": { am: -20 } } }, "2026-11-06", []);
    expect(s.map((x) => [x.time, x.done])).toEqual([["09:00", true], ["15:00", false]]);
    expect(s[1]).toMatchObject({ at: at("2026-11-06", "15:00"), deadline: at("2026-11-06", "15:30"), href: "/hygiene/t1?month=2026-11" });
    // 休業日は出さない
    expect(hygieneSlots(temp, undefined, "2026-11-06", ["2026-11-06"])).toEqual([]);
  });

  it("毎日のチェックは全部の項目に ✓、点検清掃はその日に計画した項目が全部 ●", () => {
    expect(hygieneSlots(check, { done: { "a|2026-11-06": "たなか" } }, "2026-11-06", [])[0].done).toBe(false);
    expect(hygieneSlots(check, { done: { "a|2026-11-06": "", "b|2026-11-06": "" } }, "2026-11-06", [])[0].done).toBe(true);
    // 11/4 は水曜: 床と窓（2件）。11/6 は金曜: 床だけ
    expect(hygieneSlots(clean, { done: { "x|2026-11-04": "" } }, "2026-11-04", [])[0]).toMatchObject({ done: false, what: "点検・清掃 2件（あと 1件）" });
    expect(hygieneSlots(clean, { done: { "x|2026-11-06": "" } }, "2026-11-06", [])[0]).toMatchObject({ done: true, what: "点検・清掃 1件" });
  });
});

describe("お知らせと漏れ", () => {
  const slots = hygieneSlots(temp, { temps: { "2026-11-06": { am: -20 } } }, "2026-11-06", []);

  it("時刻が来たら「まだです」（締めを dueAt に。過ぎたら赤＋責任者は alerts-store の段上げ）。書けば出ない・時刻の前は出ない", () => {
    expect(slotAlerts(slots, at("2026-11-06", "14:59"))).toEqual([]);
    const a = slotAlerts(slots, at("2026-11-06", "15:05"));
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ dedupeKey: "record:hy:t1:2026-11-06:15:00", kind: "record_due", level: "warn", title: "保管冷凍庫 温度管理表: 15:00 の温度の記録がまだです", dueAt: at("2026-11-06", "15:30") });
    expect(slotAlerts(slots, at("2026-11-06", "16:00"))[0].detail).toMatch(/締め.*過ぎました/);
    // 24時間より前のものは、お知らせではなく漏れの一覧で見る
    expect(slotAlerts(slots, at("2026-11-07", "16:00"))).toEqual([]);
  });

  it("漏れの一覧は、締めを過ぎても書いていないもの。月の分をまとめて出せる", () => {
    expect(missingRows(slots, at("2026-11-06", "15:20"))).toEqual([]);
    expect(missingRows(slots, at("2026-11-06", "15:31")).map((r) => [r.date, r.time, r.what])).toEqual([["2026-11-06", "15:00", "15:00 の温度"]]);
    const all = monthHygieneSlots([temp, check], new Map(), "2026-11", ["2026-11-03"], "2026-11-05");
    // 11/1〜11/5 のうち休業日の 11/3 を除く 4日 × (温度2回＋チェック1回)
    expect(all).toHaveLength(12);
    expect(missingRows(all, at("2026-11-05", "23:00"))).toHaveLength(12);
  });

  it("提出期限: 先月のシートで責任者の確認がまだなら、次の月の1日から。期限は次の月の何日 17:00", () => {
    const a = submitAlerts([temp, check], (id) => id === "t1", at("2026-12-01", "08:00"), { graceMin: 30, submitDay: 5, cards: true });
    expect(a).toEqual([expect.objectContaining({ dedupeKey: "record:submit:2026-11", title: expect.stringContaining("11月の衛生の記録: 責任者の確認がまだのシートが 1枚"), dueAt: at("2026-12-05", "17:00"), href: "/hygiene/missing?month=2026-11" })]);
    expect(submitAlerts([temp], () => true, at("2026-12-01", "08:00"))).toEqual([]);
  });
});

describe("製品カード", () => {
  const base = {
    date: "2026-11-07", productionDate: "2026-11-07", weekday: "土", key: "DG01", doughId: "DG01", doughName: "ロール生地", line: "bread", doughKg: 40, batches: 2,
    items: [{ productId: "P01", name: "バターロール", gram: 35, orders: 100, prep: 105 }],
    processes: [
      { key: "mix", name: "ミキサー", plannedStart: "前日 21:30", plannedEnd: "前日 21:50" },
      { key: "bake", name: "焼成", plannedStart: "4:10", plannedEnd: "5:00" },
      { key: "metal_check", name: "金属検査", plannedEnd: "6:00", ccp: true },
    ],
  } as CardBase;

  it("予定の時刻（前日も）を読み、工程の記録があるかを見る", () => {
    expect(parsePlanned("前日 21:30", "2026-11-07")).toEqual({ date: "2026-11-06", time: "21:30" });
    expect(parsePlanned("4:10", "2026-11-07")).toEqual({ date: "2026-11-07", time: "04:10" });
    const s = cardSlots(base, { items: {}, mixes: [{ kneadTempC: 27 }] });
    expect(s.map((x) => [x.key.split(":").slice(3).join(":"), x.date, x.time, x.done])).toEqual([
      ["mix", "2026-11-06", "21:50", true],
      ["bake", "2026-11-07", "05:00", false],
      ["metal:P01", "2026-11-07", "06:00", false],
    ]);
    expect(s[1].href).toBe("/cards/2026-11-07/DG01");
  });

  it("金属検査は流す回数（ミキサーの回数）ぶん。足りなければ「あと◯回分ありません」", () => {
    expect(metalRunsNeeded(base)).toBe(2);
    expect(metalRunsDone({ metal: "ok" })).toBe(1);
    expect(metalRunsDone({ metalRuns: ["ok", ""] })).toBe(1);
    const one = cardSlots(base, { items: { P01: { metalRuns: ["ok"] } } }).find((x) => x.key.endsWith("metal:P01"))!;
    expect(one).toMatchObject({ done: false, missing: 1 });
    const a = slotAlerts([one], at("2026-11-07", "06:10"));
    expect(a[0].title).toBe("製品カード ロール生地: 金属検査がまだです（バターロール あと1回）");
    expect(cardSlots(base, { items: { P01: { metalRuns: ["ok", "ng"] } } }).find((x) => x.key.endsWith("metal:P01"))!.done).toBe(true);
    // 工程は1枚のカードで1つのお知らせにまとめる
    const all = slotAlerts(cardSlots(base, undefined), at("2026-11-07", "06:40"));
    expect(all.map((x) => [x.dedupeKey, x.title])).toEqual([
      ["record:card:2026-11-07:DG01:steps", "製品カード ロール生地: ミキサー・焼成の記録がまだです"],
      ["record:card:2026-11-07:DG01:metal", "製品カード ロール生地: 金属検査がまだです（バターロール あと2回）"],
    ]);
    // 製品カードを見張らない設定
    expect(cardSlots(base, undefined, { graceMin: 30, submitDay: 5, cards: false })).toEqual([]);
  });
});
