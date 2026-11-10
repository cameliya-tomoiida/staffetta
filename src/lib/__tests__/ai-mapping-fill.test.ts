// AI で取り込む: 必須なのにファイルに無い項目を埋める（管理役2 11/7: 見出しが 名前・住所・電話・曜日 だけの得意先の CSV で、試すと3行ともエラーだった）
import { describe, expect, it } from "vitest";
import { fillRequired } from "../masters/ai-mapping";
import { customerDef } from "../masters/defs";
import type { MasterDef } from "../masters/columns";

describe("fillRequired", () => {
  it("得意先ID は今の形で続きの番号、入口・締めは例の値で埋める", () => {
    const out = fillRequired(customerDef as unknown as MasterDef, { header: ["名前", "住所"], rows: [["A店", "名古屋"], ["B店", "岐阜"]] }, ["C08", "C12", "C03"]);
    const col = (label: string) => out.rows.map((r) => r[out.header.indexOf(label)]);
    expect(col("得意先ID")).toEqual(["C13", "C14"]);
    expect(col("主な注文の入口")).toEqual(["FAX", "FAX"]);
    expect(col("注文の締め（前日）")).toEqual(["15:00", "15:00"]);
    expect(out.filled[0]).toBe("得意先ID（自動の番号）");
  });
  it("ファイルにある値はそのまま", () => {
    const out = fillRequired(customerDef as unknown as MasterDef, { header: ["得意先ID", "名前", "主な注文の入口", "注文の締め（前日）"], rows: [["K1", "A店", "電話", "17:00"]] }, []);
    expect(out.rows[0]).toEqual(["K1", "A店", "電話", "17:00"]);
    expect(out.filled).toEqual([]);
  });
});

describe("normalizeWeekdays", () => {
  it("月水金・毎日・平日・土日 をそろえる", async () => {
    const { normalizeWeekdays } = await import("../masters/ai-mapping");
    expect(normalizeWeekdays("月水金")).toBe("月;水;金");
    expect(normalizeWeekdays("月・水・金曜日")).toBe("月;水;金");
    expect(normalizeWeekdays("毎日")).toBe("日;月;火;水;木;金;土");
    expect(normalizeWeekdays("平日")).toBe("月;火;水;木;金");
    expect(normalizeWeekdays("土日")).toBe("日;土");
    expect(normalizeWeekdays("")).toBe("");
  });
});
