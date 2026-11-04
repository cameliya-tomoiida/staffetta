import { describe, expect, it } from "vitest";
import { itemsToTable, mapHeader, parseCell, parseTable, rowId, templateTable, validateItems } from "../columns";
import { equipmentDef, MASTER_DEFS, MASTER_ORDER, productDef, recipeItemDef, stepDef, validateMasters } from "../defs";
import { sampleMasters } from "../seed";
import type { Masters } from "@/data/types";

const m = sampleMasters();

describe("サンプルのマスタ", () => {
  it("全部のマスタに行がある（得意先は④）", () => {
    for (const name of MASTER_ORDER) if (name !== "customers") expect(m[name].length, name).toBeGreaterThan(0);
  });

  it("参照・重複・種類ごとの検査がすべて通る", () => {
    expect(validateMasters(m)).toEqual([]);
  });

  it("設備: ミキサー2台は同時に動かせないグループ。分割機は 1,800個/時・1ライン", () => {
    const mixers = m.equipment.filter((e) => e.kind === "mixer" && e.line === "bread");
    expect(mixers.map((e) => e.exclusiveGroup)).toEqual(["パンのミキサー", "パンのミキサー"]);
    expect(m.equipment.find((e) => e.id === "EQ-B-DIV")).toMatchObject({ piecesPerHour: 1800, lanes: 1, maxPieceGram: 150 });
  });

  it("工程: 人数・設備・CCP を持つ。食パンにはスライスがある。金属検出は CCP", () => {
    const shape = m.steps.find((s) => s.doughId === "DG01" && s.key === "shape")!;
    expect(shape.people).toBe(4);
    expect(m.steps.find((s) => s.doughId === "DG03" && s.key === "slice")).toMatchObject({ equipmentId: "EQ-B-SLC" });
    expect(m.steps.filter((s) => s.key === "metal_check").every((s) => s.ccp && s.equipmentId === "EQ-MD")).toBe(true);
    // 分割機の能力と同じ工程は「設備の能力から出す」（秒は空）
    expect(m.steps.find((s) => s.doughId === "DG01" && s.key === "divide")!.secondsPerPiece).toBeUndefined();
    // 食パンは手分割（設備なし・秒あり）
    expect(m.steps.find((s) => s.doughId === "DG03" && s.key === "divide")).toMatchObject({ secondsPerPiece: 6 });
  });

  it("商品: 包装仕様・スライス幅・金属検査、包み直しは 1枚／2枚", () => {
    expect(m.products.find((p) => p.id === "P03")).toMatchObject({ kind: "make", packStyle: "single", sliceMm: 15, metalCheck: "after_pack" });
    expect(m.products.find((p) => p.id === "P16")).toMatchObject({ kind: "repack", packStyle: "double", slicesPerPack: 2 });
    expect(m.products.find((p) => p.id === "P10")).toMatchObject({ kind: "buy", supplierId: "S07", packSizes: [6], packPrices: { 6: 144 } });
  });

  it("包材・人員もある", () => {
    expect(m.packaging.length).toBeGreaterThanOrEqual(5);
    expect(m.productPackaging.find((x) => x.productId === "P07" && x.per === "case")).toMatchObject({ packagingId: "K05" });
    expect(m.shifts.map((s) => s.name)).toContain("夜班（パン）");
  });
});

describe("CSV の書き出し → 取り込みで元に戻る", () => {
  for (const name of MASTER_ORDER) {
    it(`${MASTER_DEFS[name].label}`, () => {
      const def = MASTER_DEFS[name];
      const items = m[name] as unknown as Record<string, unknown>[];
      const table = itemsToTable(def, items);
      expect(table[0]).toEqual(def.columns.map((c) => c.label));
      const r = parseTable(def, table);
      expect(r.errors).toEqual([]);
      expect(r.items.length).toBe(items.length);
      // 型を通したあとも同じ（空の項目は既定値が入ることがあるので、元にある項目だけ比べる）
      r.items.forEach((it, i) => {
        for (const [k, v] of Object.entries(items[i])) if (v !== undefined) expect((it as Record<string, unknown>)[k], `${name}[${i}].${k}`).toEqual(v);
      });
    });
  }
});

describe("セルの読み方", () => {
  const col = (type: never | string, more = {}) => ({ key: "x", label: "x", type, ...more }) as Parameters<typeof parseCell>[0];
  it("数・整数・はい/いいえ・時刻・選択肢・リスト・入数ごとの値段", () => {
    expect(parseCell(col("number"), "1,234.5")).toEqual({ value: 1234.5 });
    expect(parseCell(col("number"), "１２０円")).toEqual({ value: 120 }); // 全角・円もよい
    expect(parseCell(col("integer"), "1.5").error).toMatch(/整数/);
    expect(parseCell(col("number", { min: 0 }), "-1").error).toMatch(/0 以上/);
    expect(parseCell(col("boolean"), "○")).toEqual({ value: true });
    expect(parseCell(col("boolean"), "いいえ")).toEqual({ value: false });
    expect(parseCell(col("boolean"), "たぶん").error).toBeTruthy();
    expect(parseCell(col("time"), "8:05")).toEqual({ value: "08:05" });
    expect(parseCell(col("time"), "25:00").error).toMatch(/08:30/);
    expect(parseCell(equipmentDef.columns.find((c) => c.key === "kind")!, "ミキサー")).toEqual({ value: "mixer" });
    expect(parseCell(equipmentDef.columns.find((c) => c.key === "kind")!, "mixer")).toEqual({ value: "mixer" });
    expect(parseCell(col("list"), "6;8")).toEqual({ value: [6, 8] });
    expect(parseCell(col("list"), "6・8")).toEqual({ value: [6, 8] });
    expect(parseCell(col("map"), "6:144;8:200")).toEqual({ value: { 6: 144, 8: 200 } });
    expect(parseCell(col("map"), "6-144").error).toBeTruthy();
    expect(parseCell(col("text", { default: "x" }), "")).toEqual({ value: "x" });
  });
});

describe("取り込みのエラー（行と列で返す）", () => {
  it("見出しは日本語の列名でも英字の項目名でもよい。順番も自由。知らない列は教える", () => {
    const h = mapHeader(recipeItemDef as never, ["ベーカーズ％", "doughId", "材料ID", "メモ"]);
    expect(h.missing).toEqual([]);
    expect(h.unknown).toEqual(["メモ"]);
  });

  it("必須の列が無ければ取り込まない", () => {
    const r = parseTable(recipeItemDef, [["生地ID", "材料ID"], ["DG01", "M01"]]);
    expect(r.items).toEqual([]);
    expect(r.errors[0]).toMatchObject({ row: 1, column: "ベーカーズ％" });
  });

  it("型・選択肢・必須のエラーは、その行だけ外して、行番号と列名を返す", () => {
    const t = itemsToTable(equipmentDef, m.equipment.slice(0, 2));
    t[1][t[0].indexOf("種類")] = "ちがう";
    t[2][t[0].indexOf("台数")] = "";
    const r = parseTable(equipmentDef, t);
    expect(r.items).toHaveLength(0);
    expect(r.errors.map((e) => [e.row, e.column])).toEqual([[2, "種類"], [3, "台数"]]);
    expect(r.errors[0].message).toMatch(/ミキサー・分割機/);
  });

  it("種類によって必須の列（自社製造なら生地ID・分割g、仕入なら仕入先・入数）", () => {
    const t = [["商品ID", "商品名", "種類", "単位", "売価（円）"], ["X1", "新しいパン", "自社製造", "個", "100"], ["X2", "仕入のパン", "仕入", "個", "100"]];
    const r = parseTable(productDef, t);
    expect(r.errors.map((e) => [e.row, e.column])).toEqual([
      [2, "ライン"], [2, "生地ID"], [2, "分割（g）"], [3, "仕入先ID"], [3, "仕入の入数"],
    ]);
  });

  it("空の行は飛ばす", () => {
    expect(parseTable(recipeItemDef, [["生地ID", "材料ID", "ベーカーズ％"], ["", "", ""], ["DG01", "M01", "100"]]).items).toHaveLength(1);
  });
});

describe("中身の検査（参照・重複・種類ごと）", () => {
  const all = (patch: Partial<Masters>) => ({ ...m, ...patch });

  it("参照先が無い・重複は、何件目のどの列かを返す", () => {
    const items = [{ doughId: "DG01", materialId: "M01", percent: 100 }, { doughId: "DG01", materialId: "M01", percent: 50 }, { doughId: "DGX", materialId: "M99", percent: 1 }];
    const e = validateItems(recipeItemDef, items, m);
    expect(e.map((x) => [x.index, x.column])).toEqual([[1, "doughId・materialId"], [2, "生地ID"], [2, "材料ID"]]);
    expect(e[1].message).toMatch(/生地マスタにありません/);
  });

  it("分割の重さが分割機の範囲の外なら教える", () => {
    const p = { ...m.products.find((x) => x.id === "P01")!, doughGram: 300 };
    expect(validateItems(productDef, [p], m)[0].message).toMatch(/分割丸め機 の範囲/);
  });

  it("量で時間が決まる工程に、秒も設備の能力も無ければ教える。金属検出は CCP", () => {
    const s1 = { ...m.steps.find((s) => s.key === "pack")!, equipmentId: undefined, secondsPerPiece: undefined };
    const s2 = { ...m.steps.find((s) => s.key === "metal_check")!, ccp: false };
    const e = validateItems(stepDef, [s1, s2], all({ steps: [s1, s2] }));
    expect(e.map((x) => x.message).join()).toMatch(/1個あたり（秒）/);
    expect(e.map((x) => x.message).join()).toMatch(/CCP/);
  });

  it("ミキサーに上限が無ければ教える", () => {
    const e = validateItems(equipmentDef, [{ ...m.equipment[0], maxBatchKg: undefined }], m);
    expect(e[0].message).toMatch(/1回の上限/);
  });
});

describe("保存用の ID・ひな形", () => {
  it("キーが1つならその値、複数なら | でつなぐ", () => {
    expect(rowId(productDef as never, { id: "P01" })).toBe("P01");
    expect(rowId(recipeItemDef as never, { doughId: "DG01", materialId: "M01" })).toBe("DG01|M01");
  });

  it("ひな形は見出し＋例の1行", () => {
    const t = templateTable(equipmentDef as never);
    expect(t[0][0]).toBe("設備ID");
    expect(t[1][0]).toBe("EQ-MIX1");
  });
});
