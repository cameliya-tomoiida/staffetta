// マスタ CSV のエンジン（⑤）のテスト。列定義は③の defs.ts。保存先は使わない（純粋な関数だけ）。
import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import type { Masters } from "@/data/types";
import { exportCsv, previewCsv, recordsToApply, templateCsv, validateForm } from "../csv";
import { materialDef, supplierDef, supplierDeliveryDef } from "../defs";

const utf8bom = (s: string) => Buffer.from("﻿" + s, "utf8");
const sjis = (s: string) => iconv.encode(s, "Shift_JIS");
type Rec = Record<string, unknown> & { id: string };

const suppliers: Rec[] = [
  { id: "S01", name: "米田製粉（デモ）", method: "fax", contact: "FAX 0000-44-4444", cutoff: "15:00", leadDays: 1, active: true },
  { id: "S04", name: "まるやま食材（デモ）", method: "infomart", contact: "インフォマート", active: true },
];
const materials: Rec[] = [
  { id: "M01", name: "強力粉", unit: "kg", supplierId: "S01", orderUnit: 25, orderUnitLabel: "25kg袋", stock: 60, safetyStock: 50, unitCost: 180, active: true },
];
const all = { suppliers, materials } as unknown as Partial<Masters>;
const HEAD = "材料ID,名前,在庫の単位,発注先（仕入先ID）,発注単位の量,発注単位の名前,在庫,安全在庫";

describe("取り込み（プレビュー）", () => {
  it("追加・更新（変わる項目の前→後）・エラーを行ごとに返す。確定はさせない", () => {
    const csv = [
      HEAD,
      "M01,強力粉,kg,S01,25,25kg袋,40,50", // 在庫 60 → 40
      "M02,ライ麦粉,kg,S01,25,25kg袋,10,5", // 新規
      "M01,強力粉,kg,S01,25,25kg袋,40,50", // 同じ ID が2回
      "M03,塩,kg,S99,abc,袋,1,1", // 数字でない・存在しない仕入先
    ].join("\r\n");
    const p = previewCsv(materialDef, utf8bom(csv), materials, all, { fileName: "m.csv" });
    expect(p.encoding).toBe("utf-8");
    expect(p.rows.map((r) => r.kind)).toEqual(["update", "add", "error", "error"]);
    const upd = p.rows[0];
    expect(upd.kind === "update" && upd.changes).toEqual([{ column: "在庫", before: "60", after: "40" }]);
    expect(p.rows[2].kind === "error" && p.rows[2].errors[0].message).toMatch(/2行目と同じ/);
    expect(p.rows[3].kind === "error" && p.rows[3].errors.map((e) => e.column)).toContain("発注単位の量");
    expect(p.canApply).toBe(false);
    expect(() => recordsToApply(p)).toThrow(/確定できません/);
  });

  it("参照先（仕入先）が無い行は、型が正しくてもエラー（同じ CSV で入る ID は参照できる）", () => {
    const csv = [HEAD, "M05,塩,kg,S99,25,25kg袋,1,1"].join("\n");
    const p = previewCsv(materialDef, utf8bom(csv), materials, all);
    expect(p.rows[0].kind === "error" && p.rows[0].errors[0].message).toMatch(/S99/);
  });

  it("Shift_JIS も読める。列の順番が違っても見出しで合わせ、CSV に無い列は今の値のまま（更新では必須の列が無くてもよい）", () => {
    const p = previewCsv(materialDef, sjis("安全在庫,在庫,材料ID\r\n50,30,M01\r\n"), materials, all);
    expect(p.encoding).toBe("shift_jis");
    expect(p.rows[0]).toMatchObject({ kind: "update", changes: [{ column: "在庫", before: "60", after: "30" }] });
    expect(p.rows[0].kind === "update" && p.rows[0].record).toMatchObject({ supplierId: "S01", name: "強力粉", active: true });
    expect(recordsToApply(p)).toHaveLength(1);
  });

  it("新規の行で必須の列が CSV に無ければ、その行はエラー", () => {
    const p = previewCsv(materialDef, utf8bom("材料ID,在庫\r\nM09,5\r\n"), materials, all);
    expect(p.rows[0].kind).toBe("error");
  });

  it("変化なしだけなら確定しない。知らない列は「使わなかった列」", () => {
    const p = previewCsv(materialDef, utf8bom("材料ID,在庫,色\r\nM01,60,白\r\n"), materials, all);
    expect(p.counts).toMatchObject({ same: 1, add: 0, update: 0 });
    expect(p.ignoredColumns).toEqual(["色"]);
    expect(p.canApply).toBe(false);
  });

  it("仕入先: 発注方法は日本語の名前で書ける", () => {
    const csv = "仕入先ID,名前,発注方法,締め時刻\r\nS01,米田製粉（デモ）,FAX,12:00\r\nS30,あおば乳業（デモ）,メール,11:00\r\n";
    const p = previewCsv(supplierDef, utf8bom(csv), suppliers, all);
    expect(p.rows.map((r) => r.kind)).toEqual(["update", "add"]);
    expect(p.rows[1].kind === "add" && p.rows[1].record).toMatchObject({ id: "S30", method: "email" });
  });

  it("キーが2列のマスタ（仕入先の便）は「仕入先ID|便ID」で1件", () => {
    const p = previewCsv(supplierDeliveryDef, utf8bom("仕入先ID,便ID,便の名前,締め時刻\r\nS01,2,午後便,15:30\r\n"), [], all);
    expect(p.rows[0]).toMatchObject({ kind: "add", id: "S01|2" });
  });

  it("見出しが合わないファイル・空のファイルはファイル全体のエラー", () => {
    expect(previewCsv(materialDef, utf8bom("a,b\r\n1,2\r\n"), materials, all).fileErrors[0]).toMatch(/列名が1つもありません/);
    expect(previewCsv(materialDef, utf8bom(""), materials, all).fileErrors[0]).toMatch(/空/);
  });
});

describe("書き出し・ひな形・個別の編集", () => {
  it("書き出した CSV をそのまま読み込むと、全部「変化なし」（往復できる）", () => {
    const out = exportCsv(supplierDef, suppliers);
    expect(out.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    const p = previewCsv(supplierDef, out, suppliers, all);
    expect(p.counts).toMatchObject({ same: 2, error: 0 });
    expect(out.toString("utf8")).toContain("FAX");
  });

  it("ひな形の例の行は「例:」で始まり、そのまま読むとエラーで気づける", () => {
    const t = templateCsv(materialDef).toString("utf8");
    expect(t.split("\r\n")[0]).toContain("名前（必須）");
    const p = previewCsv(materialDef, Buffer.from(t, "utf8"), materials, all);
    expect(p.rows[0].kind).toBe("error");
  });

  it("画面のフォームも CSV と同じ決まりで検証する", () => {
    const ok = validateForm(materialDef, { stock: "45", safetyStock: "50" }, materials[0], materials, all);
    expect(ok.record).toMatchObject({ id: "M01", stock: 45, name: "強力粉" });
    const ng = validateForm(materialDef, { stock: "-1" }, materials[0], materials, all);
    expect(ng.errors[0]).toMatchObject({ column: "在庫" });
    const dup = validateForm(materialDef, { id: "M01", name: "x", unit: "kg", orderUnit: "1", orderUnitLabel: "袋" }, undefined, materials, all);
    expect(dup.errors[0].message).toMatch(/同じ ID/);
  });
});
