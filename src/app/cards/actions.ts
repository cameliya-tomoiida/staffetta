"use server";
// 製品カード（⑦の(13)）の画面から使う処理。中身は src/lib/cards/store.ts。
import { revalidatePath } from "next/cache";
import type { CardInput } from "@/lib/cards/card";
import { approveCard, saveCardInput } from "@/lib/cards/store";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function saveCardAction(date: string, key: string, input: CardInput, who: string) {
  try {
    const r = await saveCardInput(date, key, input, who.trim() || "（現場）");
    revalidatePath("/cards");
    return { ok: true as const, problems: r.problems };
  } catch (e) {
    return { ok: false as const, error: msg(e) };
  }
}

export async function approveCardAction(date: string, key: string, who: string) {
  try {
    await approveCard(date, key, who.trim());
    revalidatePath("/cards");
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: msg(e) };
  }
}
