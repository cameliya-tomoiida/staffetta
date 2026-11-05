// マスタ画面で保存した生地・配合・商品が、③の計算（runPipeline）に効くか。保存は①の SQLite（メモリ）、読むのは③の loadMasters。
import { describe, expect, it } from "vitest";
import { DEMO_DATE, demoOrders } from "@/data/demo-orders";
import { runPipeline } from "@/lib/pipeline";
import { recipeSummary } from "../recipe";
import { loadMasters } from "../seed-db";
import * as s from "../service";

const plan = async () => runPipeline(demoOrders, DEMO_DATE, { masters: await loadMasters() });
const WHO = "専務 はやし";

describe("レシピ・生地を直す → 生産計画の kg が変わる", () => {
  it("配合の％を変えると、材料 kg が変わる（親子の保存: 行の追加・％の変更・行の削除）", async () => {
    const before = await plan();
    const d = before.production.doughs[0];
    const items = (await s.list("recipeItems")).filter((r) => r.doughId === d.doughId);
    const flourRow = items.find((r) => Number(r.percent) >= 50)!;
    const other = items.find((r) => r !== flourRow)!;
    const lines = items.filter((r) => r !== other).map((r) => ({ materialId: String(r.materialId), percent: r === flourRow ? 100 : Number(r.percent) }));
    // 1つ消し、別の材料の％を倍に
    const target = lines.find((l) => l.materialId !== flourRow.materialId)!;
    target.percent = target.percent * 2;

    const res = await s.saveRecipe(d.doughId, lines, WHO);
    expect(res.ok).toBe(true);
    expect(res.ok && res.removed).toBe(1);

    const after = await plan();
    const d2 = after.production.doughs.find((x) => x.doughId === d.doughId)!;
    expect(d2.doughKg).toBe(d.doughKg); // 生地 kg は個数×分割g÷(1−ロス率) なので％では変わらない
    expect(d2.ingredients.some((i) => i.materialId === other.materialId)).toBe(false);
    const kgOf = (p: typeof d, id: string) => p.ingredients.find((i) => i.materialId === id)!.kg;
    expect(kgOf(d2, target.materialId) / kgOf(d2, String(flourRow.materialId))).toBeCloseTo((target.percent) / 100, 2);
    expect(kgOf(d2, String(flourRow.materialId))).not.toBe(kgOf(d, String(flourRow.materialId)));

    // 記録が残る
    const h = await s.history("recipeItems");
    expect(h.some((x) => x.action === "disable" && x.who === `${WHO}（レシピ）`)).toBe(true);
  });

  it("生地のロス率を変えると、生地 kg が変わる", async () => {
    const before = await plan();
    const d = before.production.doughs[0];
    const r = await s.saveOne("doughs", d.doughId, { lossRate: "0.1" }, WHO);
    expect(r.ok).toBe(true);
    const d2 = (await plan()).production.doughs.find((x) => x.doughId === d.doughId)!;
    expect(d2.doughKg).toBeCloseTo(d.netKg / 0.9, 1);
    expect(d2.doughKg).toBeGreaterThan(d.doughKg);
  });

  it("配合にエラー（無い材料・同じ材料が2回・％が数でない）があれば、何も保存しない", async () => {
    const d = (await plan()).production.doughs[0];
    const before = (await s.list("recipeItems")).filter((r) => r.doughId === d.doughId);
    const r = await s.saveRecipe(d.doughId, [{ materialId: "M01", percent: 100 }, { materialId: "M01", percent: 2 }, { materialId: "M999", percent: 1 }, { materialId: "M02", percent: "abc" }], WHO);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.length).toBeGreaterThanOrEqual(3);
    expect((await s.list("recipeItems")).filter((x) => x.doughId === d.doughId)).toEqual(before);
  });

  it("新しい商品・生地・配合・工程を画面から足すと、計算に入る（アプリ内で完結）", async () => {
    const who = WHO;
    const dough = await s.saveOne("doughs", undefined, { name: "テスト生地", line: "bread", lossRate: "0.05", mixerMaxKg: "40" }, who);
    expect(dough.ok ? "" : JSON.stringify(dough.errors)).toBe("");
    const id = dough.ok ? dough.record.id : "";
    const rec = await s.saveRecipe(id, [{ materialId: "M01", percent: 100 }, { materialId: "M02", percent: 2 }], who);
    expect(rec.ok).toBe(true);
    const st = await s.saveOne("steps", undefined, { id: `${id}-01`, doughId: id, seq: "1", key: "mix", name: "ミキシング", people: "1", minutesPerBatch: "15" }, who);
    expect(st.ok ? "" : JSON.stringify(st.errors)).toBe("");
    const p = await s.saveOne("products", undefined, { name: "テストロール", kind: "make", unit: "個", price: "50", line: "bread", doughId: id, doughGram: "40" }, who);
    expect(p.ok ? "" : JSON.stringify(p.errors)).toBe("");
    const pid = p.ok ? p.record.id : "";
    const m = await loadMasters();
    expect(m.products.some((x) => x.id === pid)).toBe(true);
    const order = { ...demoOrders[0], id: "T-NEW", lines: [{ ...demoOrders[0].lines[0], id: "T-NEW-0", productId: pid, quantity: 100, piecesPerUnit: 1, pieces: 100 }] };
    const r = runPipeline([order], order.deliveryDate, { masters: m });
    const d = r.production.doughs.find((x) => x.doughId === id);
    expect(d?.netKg).toBe(4); // 100個 × 40g
  });
});

describe("合計の出し方", () => {
  it("粉の合計と全体の合計。粉が 100 でなければ注意", () => {
    const mats = [{ id: "M01", name: "強力粉" }, { id: "M50", name: "薄力粉" }, { id: "M02", name: "塩" }];
    expect(recipeSummary([{ materialId: "M01", percent: 80 }, { materialId: "M50", percent: 20 }, { materialId: "M02", percent: 2 }], mats)).toEqual({ total: 102, flour: 100, warnings: [] });
    expect(recipeSummary([{ materialId: "M01", percent: 90 }], mats).warnings[0]).toMatch(/90%/);
  });
});
