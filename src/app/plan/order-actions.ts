"use server";
// 作る順番の案（P2）の画面の処理。AI に案を作ってもらう・人が OK する。
import { revalidatePath } from "next/cache";
import { allOrders } from "@/demo/all-orders";
import { loadMasters } from "@/lib/masters/seed-db";
import { runPipeline } from "@/lib/pipeline";
import { approvePlanOrder, proposePlanOrder } from "@/lib/plan-order";

const D = /^\d{4}-\d{2}-\d{2}$/;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function proposePlanOrderAction(date: string) {
  try {
    if (!D.test(date)) throw new Error("日付の形が違います");
    const [{ orders }, masters] = await Promise.all([allOrders(), loadMasters()]);
    const r = runPipeline(orders, date, { masters });
    const p = await proposePlanOrder(date, r);
    revalidatePath("/plan");
    return { ok: true as const, order: p };
  } catch (e) {
    return { ok: false as const, error: msg(e) };
  }
}

export async function approvePlanOrderAction(date: string, keys: string[], who: string) {
  try {
    const p = approvePlanOrder(date, keys, who);
    revalidatePath("/plan");
    return { ok: true as const, order: p };
  } catch (e) {
    return { ok: false as const, error: msg(e) };
  }
}
