"use server";
// 値上げの流れ（人がボタンを押したときだけ）。読む → OK で原価に反映 → 卸価格を決める → 取引先へのお知らせの下書き
import { promises as fs } from "node:fs";
import { revalidatePath } from "next/cache";
import { readDb, faxFilePath } from "@/lib/store";
import { loadMasters } from "@/lib/masters/seed-db";
import { readPriceChange, toItems } from "@/lib/price-change-reader";
import { applyPriceChange, createPriceChange, decidePrices, getPriceChange, linkNotice, setMarginLine, type PriceDecision } from "@/lib/price-change";
import { draftNotice, saveNoticeDraft } from "@/lib/notices/store";
import type { NoticeInput } from "@/lib/notices/plan";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) });

/** FAX を「値上げのお知らせ」として読む → 下書き */
export async function readFaxPriceAction(faxId: string): Promise<R<{ id: string }>> {
  try {
    const fax = (await readDb()).faxes.find((f) => f.id === faxId);
    if (!fax) throw new Error("FAX が見つかりません");
    const m = await loadMasters();
    const read = await readPriceChange(await fs.readFile(faxFilePath(fax.file)), fax.receivedAt, m);
    if (!read.isPriceChange) throw new Error("値段を変えるお知らせではないようです");
    const items = toItems(read, m);
    if (!items.length) throw new Error("マスタの材料と合う品名がありませんでした");
    const sup = m.suppliers.find((s) => s.name.replace(/（[^）]*）|株式会社/g, "") === read.supplierName.replace(/（[^）]*）|株式会社/g, "")) ?? m.suppliers.find((s) => read.supplierName.includes(s.name.replace(/（[^）]*）/g, "").slice(0, 3)));
    const c = createPriceChange({
      supplierId: sup?.id ?? "",
      supplierName: sup?.name ?? read.supplierName,
      effectiveDate: read.effectiveDate,
      items,
      reason: read.reason || undefined,
      source: { kind: "fax", id: fax.id, label: fax.label },
    });
    revalidatePath("/price-changes");
    return { ok: true, id: c.id };
  } catch (e) {
    return fail(e);
  }
}

export async function applyPriceAction(id: string, who: string): Promise<R> {
  try {
    await applyPriceChange(id, who);
    revalidatePath("/price-changes", "layout");
    revalidatePath("/plan");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setLineAction(pct: number): Promise<R> {
  try {
    setMarginLine(pct);
    revalidatePath("/price-changes", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** 新しい卸価格を決めて、その商品を買っている取引先へのお知らせの下書きを作る（送るのは /notices で人が OK） */
export async function noticeFromPriceAction(id: string, decisions: PriceDecision[], from: string, who: string): Promise<R<{ noticeId: string }>> {
  try {
    if (!who.trim()) throw new Error("作る人を選んでください");
    const c = decidePrices(id, decisions, from);
    const input: NoticeInput = {
      kind: "price_up",
      effectiveDate: from,
      items: c.decisions!.map((d) => ({ productId: d.productId, name: d.name, oldPrice: d.oldPrice, newPrice: d.newPrice })),
      reason: c.reason || "原材料の値上がり",
    };
    const { draft, by } = await draftNotice(input);
    const n = await saveNoticeDraft(input, draft, by, { mode: "product", productIds: c.decisions!.map((d) => d.productId) }, who);
    linkNotice(id, n.id);
    revalidatePath("/price-changes", "layout");
    revalidatePath("/notices");
    return { ok: true, noticeId: n.id };
  } catch (e) {
    return fail(e);
  }
}

export async function getPriceChangeAction(id: string) {
  return getPriceChange(id) ?? null;
}
