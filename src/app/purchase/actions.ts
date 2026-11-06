"use server";
// 発注書の承認・送信済み（人がボタンを押したときだけ）。保存は③の purchase-store（data/db.json）。
// 下書きの中身は画面から受け取らず、サーバーで計算し直して使う（画面の値をそのまま信じない）。
import { revalidatePath } from "next/cache";
import { allOrders } from "@/demo/all-orders";
import { runPipeline } from "@/lib/pipeline";
import { approvePurchaseOrder, getPurchaseOrder, markSent, savePurchaseOrder } from "@/lib/purchase-store";
import { loadMasters } from "@/lib/masters/seed-db";

type Result = { ok: true } | { ok: false; error: string };
const fail = (e: unknown): Result => ({ ok: false, error: e instanceof Error ? e.message : String(e) });

export async function approvePoAction(input: { date: string; poId: string; who: string }): Promise<Result> {
  try {
    await approve(input);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

async function approve(input: { date: string; poId: string; who: string }) {
  if (!input.who.trim()) throw new Error("承認する人を選んでください");
  // 今の注文で下書きを作り直して保存してから承認する（承認済み・送信済みは上書きされない）
  const { orders } = await allOrders();
  const r = runPipeline(orders, input.date, { masters: await loadMasters() }); // マスタ画面で直した値で計算
  const po = [...r.productPurchaseOrders, ...r.materialPurchaseOrders].find((p) => p.id === input.poId);
  if (po) await savePurchaseOrder(po, input.who);
  else if (!(await getPurchaseOrder(input.poId))) throw new Error("発注書が見つかりません（注文が変わった可能性があります。画面を開き直してください）");
  await approvePurchaseOrder(input.poId, input.who);
  revalidatePath("/purchase");
}

/** 人が送ったあとに押す（実際の送信は⑤の送り出し画面・複合機・サイトで行う） */
export async function markSentAction(input: { poId: string; who: string; via?: string }): Promise<Result> {
  try {
    if (!input.who.trim()) throw new Error("送った人を選んでください");
    await markSent(input.poId, input.who, input.via);
    revalidatePath("/purchase");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
