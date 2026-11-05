// ⑦ 取引先の商品と卸価格: 粗利・期間の売上、取引先ごと・商品ごとのまとめ、見本のマスタ、CSV で読める列。
import { describe, expect, it } from "vitest";
import { previewCsv } from "@/lib/masters/csv";
import { customerProductDef, validateMasters } from "@/lib/masters/defs";
import { sampleMasters } from "@/lib/masters/seed";
import { summarizeByCustomer, summarizeByProduct, withMargin } from "../summary";

const row = (x: Partial<Parameters<typeof withMargin>[0]>) => withMargin({ id: `${x.customerId}|${x.code}`, customerId: "C01", code: "P01", name: "見本", active: true, ...x });

describe("粗利", () => {
  it("卸価格 − 原価・粗利率・期間の売上と粗利", () => {
    expect(row({ price: 152, cost: 133.92, quantity: 100 })).toMatchObject({ margin: 18.08, sales: 15200, profit: 1808 });
    expect(row({ price: 152, cost: 133.92 }).marginRate).toBeCloseTo(0.119, 3);
    expect(row({ price: 100 }).margin).toBeUndefined();
  });
  it("取引先ごと（売上の多い順・赤字と要確認を数える）と商品ごと（いちばん安い・高い卸価格）", () => {
    const rows = [
      row({ customerId: "A", code: "X", price: 100, cost: 60, quantity: 10 }),
      row({ customerId: "A", code: "Y", price: 50, cost: 70, quantity: 10, priceNote: "50/55" }),
      row({ customerId: "B", code: "X", price: 120, cost: 60, quantity: 100 }),
      row({ customerId: "B", code: "Z", price: 10, quantity: 1, active: false }),
    ];
    expect(summarizeByCustomer(rows)).toEqual([
      { customerId: "B", items: 1, sales: 12000, profit: 6000, negative: 0, check: 0 },
      { customerId: "A", items: 2, sales: 1500, profit: 200, negative: 1, check: 1 },
    ]);
    expect(summarizeByProduct(rows)[0]).toMatchObject({ code: "X", customers: 2, minPrice: 100, maxPrice: 120, quantity: 110 });
  });
});

describe("マスタ", () => {
  it("見本の取引先の商品は、取引先・商品を正しく参照している", () => {
    const m = sampleMasters();
    expect(m.customerProducts.length).toBeGreaterThan(10);
    expect(validateMasters(m).filter((e) => e.master === "customerProducts")).toEqual([]);
  });
  it("CSV の日本語の列名で読める（曜日・数）", () => {
    const csv = "得意先ID,商品コード,商品名,単位,卸価格（円）,原価（円）,期間の数量,よく出る曜日,最後に出た日\nC01,1334,見本ロール,P,152,133.92,1200,月;木,2026-09-30\n";
    const p = previewCsv(customerProductDef, new TextEncoder().encode(csv), [], sampleMasters());
    expect(p.counts).toMatchObject({ add: 1, error: 0 });
    const r = p.rows[0];
    if (r.kind !== "add") throw new Error(r.kind);
    expect(r.id).toBe("C01|1334");
    expect(r.record).toMatchObject({ price: 152, cost: 133.92, quantity: 1200, weekdays: [1, 4], lastDate: "2026-09-30" });
  });
});
