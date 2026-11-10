import { describe, expect, it } from "vitest";
import { faxDetailSummary, firstSentence } from "../fax-summary";

describe("FAX のくわしくの要約", () => {
  it("最初の1文だけ・長ければ切る", () => {
    expect(firstSentence("上端の発信元表示に「ひまわり保育園」とある。FAX番号も一致する。")).toBe("上端の発信元表示に「ひまわり保育園」とある。");
    expect(firstSentence("あ".repeat(80), 20)).toBe(`${"あ".repeat(19)}…`);
    expect(firstSentence("  ")).toBe("");
    expect(firstSentence("句点なしの短い文")).toBe("句点なしの短い文");
  });

  it("3行まで。止めた理由があれば先に。空のものは出さない", () => {
    const l = faxDetailSummary({ evidence: "上端に送り主名。番号も同じ。", kindReason: "見出しが「発注書」。", notes: "12日の黒糖は25に変更と手書き。ほかは定番どおり。", autoReasons: ["2行目の数がかすれている", "締めを過ぎた行がある"] });
    expect(l).toEqual(["止めた理由: 2行目の数がかすれている（ほか1件）", "メモ: 12日の黒糖は25に変更と手書き。", "送り主: 上端に送り主名。"]);
    expect(faxDetailSummary({ evidence: "", kindReason: "広告。", notes: "" })).toEqual(["種類: 広告。"]);
  });
});
