// マスタ CSV の共通エンジン（⑤）のテスト。保存先は使わない（純粋な関数だけ）。
import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import { exportCsv, previewCsv, recordsToApply, templateCsv, validateForm, type RefIndex } from "../csv";
import { materialDef, supplierDef, type MaterialRecord, type SupplierRecord } from "../defs";

const utf8bom = (s: string) => Buffer.from("﻿" + s, "utf8");
const sjis = (s: string) => iconv.encode(s, "Shift_JIS");

const suppliers: SupplierRecord[] = [
  { id: "S01", name: "米田製粉（デモ）", method: "fax", fax: "0000-44-4444", deliveries: [{ id: "1", name: "通常便", cutoff: "15:00", leadDays: 1 }] },
];
const refs: RefIndex = { suppliers: [{ id: "S01", name: "米田製粉（デモ）" }, { id: "S04", name: "まるやま食材（デモ）" }] };

const materials: MaterialRecord[] = [
  { id: "M01", name: "強力粉", unit: "kg", supplierId: "S01", orderUnit: 25, orderUnitLabel: "25kg袋", stock: 60, safetyStock: 50 },
];

describe("取り込み（プレビュー）", () => {
  it("追加・更新（変わる項目の前→後）・変化なし・エラーを行ごとに返す", () => {
    const csv = [
      "材料ID,材料名,単位,仕入先,発注単位の量,発注単位の名前,在庫,安全在庫",
      "M01,強力粉,kg,S01,25,25kg袋,40,50", // 在庫 60 → 40
      ",ライ麦粉,kg,米田製粉（デモ）,25,25kg袋,10,5", // 新規（仕入先は名前で）
      "M01,強力粉,kg,S01,25,25kg袋,40,50", // 同じ ID が2回
      ",塩,グラム,S99,abc,袋,1,1", // エラー3つ
    ].join("\r\n");
    const p = previewCsv(materialDef, utf8bom(csv), materials, { fileName: "m.csv", refs });
    expect(p.encoding).toBe("utf-8");
    expect(p.rows.map((r) => r.kind)).toEqual(["update", "add", "error", "error"]);
    const upd = p.rows[0];
    expect(upd.kind === "update" && upd.changes).toEqual([{ column: "在庫", before: "60", after: "40" }]);
    const add = p.rows[1];
    expect(add.kind === "add" && add.record).toMatchObject({ id: "M02", supplierId: "S01", stock: 10 });
    const dup = p.rows[2];
    expect(dup.kind === "error" && dup.errors[0].message).toMatch(/2行目と同じ ID/);
    const bad = p.rows[3];
    expect(bad.kind === "error" && bad.errors.map((e) => e.column)).toEqual(["単位", "仕入先", "発注単位の量"]);
    expect(p.canApply).toBe(false);
    expect(() => recordsToApply(p)).toThrow(/確定できません/);
  });

  it("Shift_JIS の CSV も読める。列の順番が違っても、見出しで合わせる", () => {
    const csv = "安全在庫,在庫,材料名,材料ID\r\n50,30,強力粉,M01\r\n";
    const p = previewCsv(materialDef, sjis(csv), materials, { refs });
    expect(p.encoding).toBe("shift_jis");
    expect(p.rows[0]).toMatchObject({ kind: "update", changes: [{ column: "在庫", before: "60", after: "30" }] });
    // CSV に無い列（仕入先など）は今の値のまま
    expect(p.rows[0].kind === "update" && p.rows[0].record.supplierId).toBe("S01");
    expect(p.missingColumns).toContain("仕入先");
    expect(recordsToApply(p)).toHaveLength(1);
  });

  it("変化なしだけなら確定しない。知らない列は無視したと返す", () => {
    const csv = "材料ID,材料名,在庫,色\r\nM01,強力粉,60,白\r\n";
    const p = previewCsv(materialDef, utf8bom(csv), materials, { refs });
    expect(p.counts).toMatchObject({ same: 1, add: 0, update: 0 });
    expect(p.ignoredColumns).toEqual(["色"]);
    expect(p.canApply).toBe(false);
  });

  it("仕入先: 発注方法は日本語の名前で書ける。便は列で書く。マスタ固有のチェックが効く", () => {
    const csv = [
      "仕入先ID,仕入先名,発注方法,FAX番号,メール,1便 締め,1便 リードタイム,2便 名前,2便 締め",
      "S01,米田製粉（デモ）,FAX,0000-44-4444,,14:00,1,,", // 締め 15:00 → 14:00
      ",あおば乳業（デモ）,メール,,,11時,2,午後便,15:30",
      ",みどり油（デモ）,FAX,,,,,,", // FAX なのに番号なし
    ].join("\n");
    const p = previewCsv(supplierDef, utf8bom(csv), suppliers);
    expect(p.rows.map((r) => r.kind)).toEqual(["update", "error", "error"]);
    expect(p.rows[0].kind === "update" && p.rows[0].changes).toEqual([{ column: "1便 締め", before: "15:00", after: "14:00" }]);
    expect(p.rows[1].kind === "error" && p.rows[1].errors[0].message).toMatch(/メールアドレス/);
    expect(p.rows[2].kind === "error" && p.rows[2].errors[0].message).toMatch(/FAX番号/);
  });

  it("見出しが合わないファイル・空のファイルはファイル全体のエラー", () => {
    expect(previewCsv(materialDef, utf8bom("a,b\r\n1,2\r\n"), materials).fileErrors[0]).toMatch(/列名が1つもありません/);
    expect(previewCsv(materialDef, utf8bom(""), materials).fileErrors[0]).toMatch(/空/);
  });
});

describe("書き出し・テンプレート・個別の編集", () => {
  it("書き出した CSV をそのまま読み込むと、全部「変化なし」になる（往復できる）", () => {
    const out = exportCsv(supplierDef, suppliers);
    expect(out.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    const p = previewCsv(supplierDef, out, suppliers);
    expect(p.counts).toMatchObject({ same: 1, error: 0 });
    expect(out.toString("utf8")).toContain("FAX"); // 発注方法は日本語の名前で出る
  });

  it("テンプレートの例の行は「例:」で始まり、そのまま読むとエラーで気づける", () => {
    const t = templateCsv(materialDef).toString("utf8");
    expect(t.split("\r\n")[0]).toContain("材料名（必須）");
    const p = previewCsv(materialDef, Buffer.from(t, "utf8"), materials, { refs });
    expect(p.rows[0].kind).toBe("error");
  });

  it("画面のフォームも CSV と同じ決まりで検証する", () => {
    const ok = validateForm(materialDef, { stock: "45", safetyStock: "50" }, materials[0], refs);
    expect(ok.record).toMatchObject({ id: "M01", stock: 45 });
    const ng = validateForm(materialDef, { stock: "-1" }, materials[0], refs);
    expect(ng.errors[0]).toMatchObject({ column: "在庫" });
  });
});
