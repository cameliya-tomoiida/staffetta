import { describe, expect, it } from "vitest";
import { applyTransforms, detectHeader, headersOf, needsLook, ruleMapping, shapeKey, toMasterCsv, type Mapping } from "../masters/ai-mapping";
import { customerDef } from "../masters/defs";
import type { MasterDef } from "../masters/columns";

const def = customerDef as unknown as MasterDef;
// 弥生から出したような、題の行があり、見出しが2行・列名がばらばらの表（中身は架空）
const grid = [
  ["得意先一覧表", "", "", "", "", ""],
  ["", "", "", "", "", ""],
  ["得意先", "", "所在地", "", "連絡", "備考"],
  ["コード", "名称", "住所１", "住所２", "ＴＥＬ", ""],
  ["００１２", "ひまわり保育園（デモ）", "愛知県名古屋市昭和区", "御器所1-2", "052-000-0001", "8時まで"],
  ["0345", "みなと給食（デモ）", "愛知県名古屋市港区", "", "052-000-0002", ""],
  ["", "", "", "", "", ""],
  ["合計", "", "", "", "", ""],
];

describe("AI で取り込む（決まりの部分・⑧）", () => {
  it("題の行を飛ばし、2行の見出しを見つけて、上の行（結合セル）を引き継いでつなぐ", () => {
    const h = detectHeader(grid);
    expect(h).toEqual({ headerStart: 2, headerRows: 2 });
    expect(headersOf(grid, 2, 2)).toEqual(["得意先 コード", "得意先 名称", "所在地 住所１", "所在地 住所２", "連絡 ＴＥＬ", "備考"]);
  });
  it("見出しの名前から当てる（よくある呼び方）。決められない列は使わない・黄色", () => {
    const cols = ruleMapping(def, ["コード", "名称", "住所１", "住所２", "ＴＥＬ", "ふしぎな列"]);
    expect(cols.map((c) => c.target)).toEqual(["id", "name", "address", "address", "phone", null]);
    expect(needsLook({ ...cols[0], confidence: 0.5 })).toBe(true);
    expect(needsLook(cols[1])).toBe(false);
  });
  it("対応どおりにマスタの形の CSV にする（住所1・2 をつなぐ・ID の頭・全角→半角・合計と空の行は飛ばす）", () => {
    const m: Mapping = {
      master: "customers", headerStart: 2, headerRows: 2, source: "ai",
      columns: [
        { source: 0, header: "得意先 コード", target: "id", reason: "", confidence: 0.9, transforms: ["nfkc"], prefix: "R-" },
        { source: 1, header: "得意先 名称", target: "name", reason: "", confidence: 0.9, transforms: [] },
        { source: 2, header: "住所１", target: "address", reason: "", confidence: 0.9, transforms: [] },
        { source: 3, header: "住所２", target: "address", reason: "", confidence: 0.9, transforms: [] },
        { source: 4, header: "TEL", target: "phone", reason: "", confidence: 0.9, transforms: [] },
        { source: 5, header: "備考", target: null, reason: "", confidence: 0, transforms: [] },
      ],
    };
    const out = toMasterCsv(def, grid, m);
    expect(out.header).toEqual(["得意先ID", "名前", "住所", "電話"]);
    expect(out.rows).toEqual([
      ["R-0012", "ひまわり保育園（デモ）", "愛知県名古屋市昭和区 御器所1-2", "052-000-0001"],
      ["R-0345", "みなと給食（デモ）", "愛知県名古屋市港区", "052-000-0002"],
    ]);
  });
  it("直し方: 数字だけ・お金・日付（令和も）", () => {
    expect(applyTransforms("Ｎｏ．０１２", { transforms: ["digits"] })).toBe("012");
    expect(applyTransforms("¥1,234円", { transforms: ["number"] })).toBe("1234");
    expect(applyTransforms("2026/1/5", { transforms: ["date"] })).toBe("2026-01-05");
    expect(applyTransforms("R8.11.6", { transforms: ["date"] })).toBe("2026-11-06");
  });
  it("同じ見出しの並びなら同じ形（覚えた対応を使う）", () => {
    expect(shapeKey("customers", ["コード", "名称"])).toBe(shapeKey("customers", ["ｺｰﾄﾞ ", "名称"]));
    expect(shapeKey("customers", ["コード", "名称"])).not.toBe(shapeKey("products", ["コード", "名称"]));
  });
});
