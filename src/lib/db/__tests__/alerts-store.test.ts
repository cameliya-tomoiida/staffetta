import { beforeEach, describe, expect, it } from "vitest";
import { alertCounts, listAlerts, setAlertSettings, syncAlerts, tickAlerts, updateAlert, type AlertCandidate } from "../alerts-store";
import { getDb } from "../sqlite";
import { judgeSystem, usualFaxHours } from "@/lib/system-watch";
import { runAlertCheck } from "@/lib/scheduler";
import { setFlag } from "@/lib/settings/features";

const c = (key: string, extra: Partial<AlertCandidate> = {}): AlertCandidate => ({ dedupeKey: key, kind: "test", level: "warn", title: `見出し ${key}`, ...extra });
const T = (h: number, d = 5) => `2026-11-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00+09:00`;

describe("アラートの保存", () => {
  beforeEach(() => {
    getDb().exec("DROP TABLE IF EXISTS alerts");
    // ensureTables は1回しか作らないので、消したら作り直す
    (globalThis as unknown as { __hubSchemas?: Set<string> }).__hubSchemas?.delete("alerts");
    setAlertSettings({ escalateTo: "専務 はやし" }, "テスト");
  });

  it("同じ dedupeKey は1件。判定から消えたら自動で済み、また出たら新しいに戻る", () => {
    expect(syncAlerts("logic", [c("a"), c("a"), c("b")], T(9)).map((r) => r.dedupeKey)).toEqual(["a", "b"]);
    expect(listAlerts()).toHaveLength(2);
    expect(syncAlerts("logic", [c("a")], T(10))).toEqual([]); // 新しいものは無い
    expect(listAlerts().map((r) => r.dedupeKey)).toEqual(["a"]);
    expect(listAlerts({ states: ["done"] })[0]).toMatchObject({ dedupeKey: "b", state: "done" });
    const again = syncAlerts("logic", [c("a"), c("b")], T(11));
    expect(again.map((r) => r.dedupeKey)).toEqual(["b"]);
    expect(listAlerts().find((r) => r.dedupeKey === "b")?.history.at(-1)?.what).toBe("また出ました");
  });

  it("記録の時刻は日本時間（UTC で渡しても +09:00 にそろえる）", () => {
    syncAlerts("logic", [c("a")], "2026-11-05T03:00:00.000Z");
    const r = listAlerts()[0];
    expect(r.createdAt).toBe("2026-11-05T12:00:00.000+09:00");
    expect(r.history[0].at).toBe("2026-11-05T12:00:00.000+09:00");
    const s = updateAlert("a", { snoozeUntil: "2026-11-05T05:00:00.000Z" }, "事務 たなか", "2026-11-05T03:30:00.000Z");
    expect(s.snoozeUntil).toBe("2026-11-05T14:00:00.000+09:00");
    expect(s.history.at(-1)?.what).toContain("11/5 14:00");
  });

  it("ほかの判定元のアラートは、解消の判定に巻き込まない", () => {
    syncAlerts("system", [c("s")], T(9));
    syncAlerts("logic", [], T(9));
    expect(listAlerts().map((r) => r.dedupeKey)).toEqual(["s"]);
  });

  it("見た・あとで・済み・担当者を変えると履歴が残り、あとでの時刻が来たら戻る", () => {
    syncAlerts("logic", [c("a")], T(9));
    updateAlert("a", { state: "seen" }, "事務 たなか", T(9));
    updateAlert("a", { snoozeUntil: T(12), assignee: "製造 グエン" }, "事務 たなか", T(10));
    expect(alertCounts()).toMatchObject({ open: 0, snoozed: 1 });
    expect(() => updateAlert("a", { snoozeUntil: T(8) }, "事務 たなか", T(10))).toThrow();
    tickAlerts(T(13));
    const r = listAlerts()[0];
    expect(r.state).toBe("seen");
    expect(r.assignee).toBe("製造 グエン");
    expect(r.history.map((h) => h.who)).toEqual(["システム", "事務 たなか", "事務 たなか", "システム"]);
    // 判定が出し直しても、人が付けた担当者は残る
    syncAlerts("logic", [c("a", { assignee: "別の人" })], T(14));
    expect(listAlerts()[0].assignee).toBe("製造 グエン");
  });

  it("期限を過ぎたら level を1段上げ、上の人に知らせる印を付ける（1回だけ）", () => {
    syncAlerts("logic", [c("a", { level: "warn", dueAt: T(12) })], T(9));
    expect(tickAlerts(T(11))).toEqual([]);
    const up = tickAlerts(T(12));
    expect(up).toHaveLength(1);
    expect(listAlerts()[0]).toMatchObject({ level: "danger", escalatedTo: "専務 はやし" });
    expect(tickAlerts(T(13))).toEqual([]);
    expect(listAlerts({ assignee: "専務 はやし" })).toHaveLength(1);
    expect(alertCounts().danger).toBe(1);
  });
});

describe("仕組みの見張り", () => {
  // 11/1〜11/4 の 9時台に FAX が届いていた
  const times = [1, 2, 3, 4].map((d) => T(9, d));

  it("いつもの時間帯に2時間以上届かなければ知らせる。いつもでない時間なら知らせない", () => {
    expect(usualFaxHours(times, T(10))).toEqual([9]);
    const at = "2026-11-05T09:30:00+09:00";
    expect(judgeSystem({ now: at, gmailFaxTimes: times }).map((a) => a.kind)).toContain("system_fax_gap");
    expect(judgeSystem({ now: T(15), gmailFaxTimes: times }).map((a) => a.kind)).not.toContain("system_fax_gap");
    expect(judgeSystem({ now: at, gmailFaxTimes: [...times, "2026-11-05T08:50:00+09:00"] }).map((a) => a.kind)).not.toContain("system_fax_gap");
    // データが少ないうち（3日未満）は、いつもの時間帯が無いので知らせない
    expect(judgeSystem({ now: at, gmailFaxTimes: times.slice(0, 2) })).toEqual([]);
  });

  it("バックアップが7日ない・ディスクの空きが少ないと知らせる", () => {
    const kinds = (x: Parameters<typeof judgeSystem>[0]) => judgeSystem(x).map((a) => `${a.kind}:${a.level}`);
    expect(kinds({ now: T(9, 12), gmailFaxTimes: [], lastExportAt: T(9, 5) })).toEqual(["system_backup:warn"]);
    expect(kinds({ now: T(9, 10), gmailFaxTimes: [], lastExportAt: T(9, 5) })).toEqual([]);
    expect(kinds({ now: T(9, 20), gmailFaxTimes: [], startedAt: T(9, 4) })).toEqual(["system_backup:danger"]);
    expect(kinds({ now: T(9), gmailFaxTimes: [], disk: { freeBytes: 1 * 1024 ** 3, totalBytes: 500 * 1024 ** 3 } })).toEqual(["system_disk:danger"]);
    expect(kinds({ now: T(9), gmailFaxTimes: [], disk: { freeBytes: 100 * 1024 ** 3, totalBytes: 500 * 1024 ** 3 } })).toEqual([]);
  });
});

describe("5分ごとの判定", () => {
  beforeEach(() => {
    getDb().exec("DROP TABLE IF EXISTS alerts");
    (globalThis as unknown as { __hubSchemas?: Set<string> }).__hubSchemas?.delete("alerts");
    setFlag("alerts", true, "テスト");
    setFlag("system_watch", true, "テスト");
  });

  it("判定元の結果を保存し、機能を OFF にした判定元のアラートは済みになる", async () => {
    const src = { name: "x", feature: "system_watch" as const, run: async () => [c("x1")] };
    expect((await runAlertCheck(T(9), [src])).fresh).toBe(1);
    setFlag("system_watch", false, "テスト");
    await runAlertCheck(T(10), [src]);
    expect(listAlerts()).toEqual([]);
  });

  it("お知らせを使わない設定なら何もしない", async () => {
    setFlag("alerts", false, "テスト");
    const r = await runAlertCheck(T(9), [{ name: "x", run: async () => [c("x1")] }]);
    expect(r.fresh).toBe(0);
    setFlag("alerts", true, "テスト");
  });
});
