"use server";
// 製造の画面から、商品のロス率（%）をその場で直す（担当者 11/7: 数字を押すと直せる形）。商品マスタに保存して、計画を作り直す
import { revalidatePath } from "next/cache";
import { getMaster, upsertMasters } from "@/lib/db/masters";
import { currentUser } from "@/lib/auth/current-user";

export async function setLossRateAction(productId: string, rate: number | null): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (rate != null && (!Number.isFinite(rate) || rate < 0 || rate > 100)) throw new Error("0〜100 の数で入れてください");
    const p = await getMaster<{ id: string; overRate?: number }>("products", productId);
    if (!p) throw new Error("この商品がマスタにありません");
    const { overRate: _o, ...rest } = p;
    const next = rate == null || rate === 0 ? rest : { ...rest, overRate: Math.round(rate * 10) / 10 };
    const who = (await currentUser().catch(() => null))?.name ?? "製造の画面";
    await upsertMasters("products", [next], who);
    revalidatePath("/plan");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
