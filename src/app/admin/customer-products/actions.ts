"use server";
// 取引先の商品と卸価格（⑦）の画面から使う処理。保存は⑤のマスタの窓口（saveOne・remove）＝検査と変えた記録つき。
import { revalidatePath } from "next/cache";
import { remove, restore, saveOne } from "@/lib/masters/service";

const NAME = "customerProducts";
const done = () => revalidatePath("/admin/customer-products");

/** 1行を保存（id があれば直す、無ければ足す）。値は列のキーと文字 */
export async function saveCustomerProductAction(id: string | undefined, input: Record<string, string>, who: string) {
  try {
    const r = await saveOne(NAME, id, input, who || "事務");
    if (!r.ok) return { ok: false as const, error: r.errors.map((e) => `${e.column ? `${e.column}: ` : ""}${e.message}`).join("／") };
    done();
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 外す（消さずに「使わない」にする。もどせる） */
export async function removeCustomerProductAction(id: string, who: string) {
  await remove(NAME, id, who || "事務");
  done();
}

export async function restoreCustomerProductAction(id: string, who: string) {
  await restore(NAME, id, who || "事務");
  done();
}
