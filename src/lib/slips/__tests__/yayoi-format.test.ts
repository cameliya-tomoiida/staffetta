import { beforeEach, describe, expect, it } from "vitest";
import iconv from "iconv-lite";
import { getDb } from "@/lib/db/sqlite";
import type { DeliverySlip } from "../calc";
import { columnsFromHeader, DEFAULT_YAYOI_FORMAT, formatDate, normalizeFormat, yayoiCsv, yayoiTable, type YayoiFormat } from "../yayoi-format";

const slip: DeliverySlip = {
  no: "D-20261106-C001",
  date: "2026-11-06",
  customerId: "C001",
  customerName: "見本の取引先（デモ）",
  lines: [
    { productId: "P001", code: "1001", name: "バターロール", quantity: 30, unit: "個", unitPrice: 38, amount: 1140, taxRate: 8, priceFrom: "卸価格" },
    { productId: "P003", name: "配送料", quantity: 1, unit: "式", unitPrice: 500, amount: 500, taxRate: 10, priceFrom: "売価" },
  ],
  totals: { byRate: [], net: 1640, tax: 0, total: 1640 },
  orderIds: [],
};

describe("弥生の CSV の様式", () => {
  it("初期の見本は、これまでの列と同じ（Shift_JIS・見出しあり・2026/11/06）", () => {
    expect(DEFAULT_YAYOI_FORMAT.columns.map((c) => c.label)).toEqual(["伝票日付", "伝票番号", "得意先コード", "得意先名", "行", "商品コード", "商品名", "数量", "単位", "単価", "金額", "税率", "備考"]);
    const rows = yayoiTable([slip], DEFAULT_YAYOI_FORMAT);
    expect(rows[0]).toEqual(["2026/11/06", "D-20261106-C001", "C001", "見本の取引先（デモ）", 1, "1001", "バターロール", 30, "個", 38, 1140, "8%（軽減）", ""]);
    expect(rows[1].slice(4, 7)).toEqual([2, "P003", "配送料"]);
    const csv = yayoiCsv([slip], DEFAULT_YAYOI_FORMAT);
    expect(csv.startsWith('"伝票日付","伝票番号"')).toBe(true);
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(3);
  });

  it("日付の形: 2026/11/06・2026-11-06・20261106・令和8年11月6日・R08/11/06", () => {
    expect(formatDate("2026-11-06", "slash")).toBe("2026/11/06");
    expect(formatDate("2026-11-06", "hyphen")).toBe("2026-11-06");
    expect(formatDate("2026-11-06", "compact")).toBe("20261106");
    expect(formatDate("2026-11-06", "reiwa")).toBe("令和8年11月6日");
    expect(formatDate("2026-11-06", "reiwaShort")).toBe("R08/11/06");
    expect(formatDate("2019-05-01", "reiwa")).toBe("令和元年5月1日");
  });

  it("列の順を変え・決まった値の列（取引区分＝掛売上）・空の列・見出しなし・タブ区切り・UTF-8", () => {
    const f: YayoiFormat = {
      columns: [
        { label: "取引区分", source: "fixed", value: "掛売上" },
        { label: "日付", source: "date" },
        { label: "商品名", source: "productName" },
        { label: "予備", source: "blank" },
        { label: "税区分", source: "taxKind" },
        { label: "担当", source: "staffCode" },
      ],
      header: false,
      encoding: "utf8",
      dateFormat: "compact",
      delimiter: "tab",
      staffCode: "0007",
    };
    const csv = yayoiCsv([slip], f);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('"掛売上"\t"20261106"\t"バターロール"\t""\t"軽減税率8%"\t"0007"');
    expect(lines[1]).toContain('"標準税率10%"');
  });

  it("Shift_JIS では BOM を付けず、そのまま変換できる", () => {
    const csv = yayoiCsv([slip], DEFAULT_YAYOI_FORMAT);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(iconv.decode(iconv.encode(csv, "Shift_JIS"), "Shift_JIS")).toBe(csv);
  });

  it("弥生の見出しの行を貼ると並びができる（分からない名前は空の列）", () => {
    const cols = columnsFromHeader('"伝票日付","伝票No","取引区分","得意先コード","得意先名","商品コード","商品名","数量","単価","金額","税区分","摘要","担当者コード"\r\n"2026/11/06",...');
    expect(cols.map((c) => c.source)).toEqual(["date", "slipNo", "blank", "customerCode", "customerName", "productCode", "productName", "quantity", "unitPrice", "amount", "taxKind", "note", "staffCode"]);
    expect(cols[2].label).toBe("取引区分");
    expect(columnsFromHeader("日付\t品名\t数量").map((c) => c.source)).toEqual(["date", "productName", "quantity"]);
    expect(columnsFromHeader("  ")).toEqual([]);
  });

  it("保存の前に整える: 列が無い・見出しが空は止める。知らない中身は空にする", () => {
    expect(() => normalizeFormat({ columns: [] })).toThrow(/列を1つ以上/);
    expect(() => normalizeFormat({ columns: [{ label: " ", source: "date" }] })).toThrow(/1列目の見出し/);
    const n = normalizeFormat({ columns: [{ label: "x", source: "nope" as never }], encoding: "x" as never });
    expect(n.columns[0].source).toBe("blank");
    expect(n.encoding).toBe("sjis");
    expect(n.header).toBe(true);
  });
});

describe("様式の保存（kv）", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM kv WHERE key LIKE 'yayoi_format%'");
  });

  it("無ければ初期の見本。保存すると次からその形。保存する人がいないと止める。初期に戻せる", async () => {
    const s = await import("../yayoi-format-store");
    expect(s.getYayoiFormat()).toEqual(DEFAULT_YAYOI_FORMAT);
    expect(() => s.setYayoiFormat(DEFAULT_YAYOI_FORMAT, "")).toThrow(/保存する人/);
    s.setYayoiFormat({ ...DEFAULT_YAYOI_FORMAT, encoding: "utf8", columns: [{ label: "日付", source: "date" }] }, "うえの");
    expect(s.getYayoiFormat()).toMatchObject({ encoding: "utf8", columns: [{ label: "日付", source: "date" }] });
    s.resetYayoiFormat("うえの");
    expect(s.getYayoiFormat()).toEqual(DEFAULT_YAYOI_FORMAT);
  });
});
