import { describe, expect, it } from "vitest";
import type { AlertCandidate } from "@/lib/db/alerts-store";
import { triageAlerts } from "../triage";

const a = (kind: string, n: number, level: AlertCandidate["level"] = "warn"): AlertCandidate => ({ dedupeKey: `${kind}:${n}`, kind, level, title: `${kind} ${n}`, href: "/x", dueAt: `2026-11-0${n}T10:00:00+09:00` });

describe("お知らせを先に判断する", () => {
  it("知らせるだけの物（新しいもの・見直しの時期）は自動で片づける", () => {
    const r = triageAlerts("logic", [a("new_things", 1, "info"), a("cost_review_due", 2, "info"), a("po_not_sent", 3, "danger")]);
    expect(r.auto.map((x) => x.kind)).toEqual(["new_things", "cost_review_due"]);
    expect(r.keep.map((x) => x.kind)).toEqual(["po_not_sent"]);
  });

  it("同じ種類が何件もあれば1件にまとめて「AI の判断：… よろしいですか？」。いちばん強い level・早い期限", () => {
    const r = triageAlerts("logic", [a("stock_shortage", 3), a("stock_shortage", 1, "danger"), a("stock_shortage", 2), a("review_backlog", 4)]);
    expect(r.keep).toHaveLength(2);
    const g = r.keep.find((x) => x.kind === "stock_shortage")!;
    expect(g.title).toBe("AI の判断：足りなくなる材料 3品を、仕入先ごとの発注の案にまとめました。よろしいですか？");
    expect(g.level).toBe("danger");
    expect(g.dueAt).toBe("2026-11-01T10:00:00+09:00");
    expect(g.dedupeKey).toBe("group:logic:stock_shortage");
    expect(g.actions?.map((x) => x.label)).toEqual(["OK・発注の案を見る", "直す"]);
    expect(g.detail).toContain("・stock_shortage 3");
  });

  it("3100 くらいの数（33件）でも、まとめると数件になる", () => {
    const list = [
      ...Array.from({ length: 13 }, (_, i) => a("record_missing", i, "danger")),
      ...Array.from({ length: 5 }, (_, i) => a("margin_low", i)),
      ...Array.from({ length: 6 }, (_, i) => a("stock_shortage", i)),
      ...Array.from({ length: 3 }, (_, i) => a("new_things", i, "info")),
      a("po_not_sent", 1, "danger"), a("review_backlog", 1, "danger"),
    ];
    const r = triageAlerts("logic", list);
    expect(r.keep.length).toBe(5);
    expect(r.auto.length).toBe(3);
  });
});
