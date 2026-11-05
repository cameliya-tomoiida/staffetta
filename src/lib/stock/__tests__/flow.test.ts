// 在庫の出入りの通し: 発注 → 承認 → 送信 → 入荷（在庫が増える）→ 製造の実績（在庫が減る）→ 次の発注書の量が変わる。
// マスタは①の SQLite（メモリ）、発注書と注文はメモリの store。
import { describe, expect, it, vi } from "vitest";
import { DEMO_DATE, demoOrders } from "@/data/demo-orders";
import { loadMasters } from "@/lib/masters/seed-db";
import { runPipeline } from "@/lib/pipeline";

vi.mock("@/lib/store", () => import("@/lib/channels/__tests__/memdb"));

const WHO = "課長 こばやし";
const plan = async () => runPipeline(demoOrders, DEMO_DATE, { masters: await loadMasters() });
const stockOf = async (master: "materials" | "packaging", id: string) => Number((await loadMasters())[master].find((x) => x.id === id)?.stock ?? 0);

describe("在庫の出入り", () => {
  it("発注→入荷→製造→在庫が減る→次の発注書の量が変わる", async () => {
    const ps = await import("@/lib/purchase-store");
    const st = await import("../store");
    const first = await plan();
    const po = first.materialPurchaseOrders.find((p) => p.lines.some((l) => l.itemType === "material" && l.quantity > 0))!;
    expect(po).toBeDefined();
    const line = po.lines.find((l) => l.itemType === "material" && l.quantity > 0)!;
    const before = await stockOf("materials", line.itemId);

    // 下書き → 承認 → 送信済み（人が押したときだけ）。送信前は入荷にできない
    await ps.savePurchaseOrders([po], WHO);
    await ps.approvePurchaseOrder(po.id, WHO);
    await expect(st.receivePurchaseOrder(po.id, undefined, WHO)).rejects.toThrow(/送信済み/);
    await ps.markSent(po.id, WHO);

    // 入荷（初期値は発注した量）→ 在庫が増え、動きが残る
    const rec = await st.receivePurchaseOrder(po.id, undefined, WHO);
    expect(await stockOf("materials", line.itemId)).toBeCloseTo(before + line.quantity, 3);
    expect(rec.moves.find((m) => m.itemId === line.itemId)).toMatchObject({ kind: "receive", qty: line.quantity, before, ref: po.id, who: WHO });

    // 入荷で在庫が増えたので、次の発注書ではこの材料の量が減る（または要らなくなる）
    const second = await plan();
    const qtyOf = (r: typeof first) => r.materialPurchaseOrders.flatMap((p) => p.lines).filter((l) => l.itemId === line.itemId).reduce((s, l) => s + l.quantity, 0);
    expect(qtyOf(second)).toBeLessThan(qtyOf(first));

    // 届いた量を直す（発注の半分しか来なかった）→ 差だけ動く。二重に足さない
    const half = line.quantity / 2;
    const fix = await st.receivePurchaseOrder(po.id, po.lines.filter((l) => l.itemType === "material").map((l) => ({ itemId: l.itemId, quantity: l.itemId === line.itemId ? half : l.quantity })), WHO);
    expect(fix.moves.find((m) => m.itemId === line.itemId)).toMatchObject({ qty: -half, note: "入荷の数を直した" });
    expect(await stockOf("materials", line.itemId)).toBeCloseTo(before + half, 3);
    await st.receivePurchaseOrder(po.id, fix.receipt!.lines, WHO); // 同じ数でもう一度押しても動かない
    expect(await stockOf("materials", line.itemId)).toBeCloseTo(before + half, 3);

    // 製造の実績: 計画どおり作った → レシピ×数（ロス込み）で材料を引く
    const made = first.production.doughs.flatMap((d) => d.items.map((i) => ({ productId: i.productId, pieces: i.pieces })));
    const flourId = first.materials[0].materialId;
    const beforeUse = await stockOf("materials", flourId);
    const done = await st.recordProduction(first.productionDate, made, WHO);
    const used = done.usage.materials.find((m) => m.id === flourId)!.qty;
    expect(used).toBeCloseTo(first.materials[0].needUnits, 2); // ③の計画の所要量と同じ
    expect(await stockOf("materials", flourId)).toBeCloseTo(Math.max(0, beforeUse - used), 2);
    expect(done.usage.packaging.length).toBeGreaterThan(0); // 商品の包材も引く

    // 実績を直す（1品を半分に）→ 差だけ戻る。同じ日をもう一度押しても二重に引かない
    const fixed = made.map((m, i) => (i === 0 ? { ...m, pieces: Math.floor(m.pieces / 2) } : m));
    const re = await st.recordProduction(first.productionDate, fixed, WHO);
    expect(re.moves.every((m) => m.note.includes("直した") || m.note.includes("足りません"))).toBe(true);
    const again = await st.recordProduction(first.productionDate, fixed, WHO);
    expect(again.moves).toEqual([]);

    // 製造で在庫が減ったので、次の発注書の量が増える
    const third = await plan();
    const total = (r: typeof first) => r.materialPurchaseOrders.flatMap((p) => p.lines).reduce((s, l) => s + l.quantity, 0);
    expect(total(third)).toBeGreaterThan(total(second));

    // 動きの記録（新しい順）
    const moves = st.listMoves("materials", line.itemId);
    expect(moves.map((m) => m.kind)).toEqual(expect.arrayContaining(["receive", "use"]));
  });

  it("棚卸の差も動きに残る。安全在庫を下回ると一覧に出る", async () => {
    const s = await import("@/lib/masters/service");
    const st = await import("../store");
    await s.stocktake("packaging", "K01", 0, WHO, "数え直し");
    expect(st.listMoves("packaging", "K01")[0]).toMatchObject({ kind: "stocktake", after: 0, who: WHO });
    expect((await st.lowStockItems()).some((x) => x.id === "K01")).toBe(true);
  });
});
