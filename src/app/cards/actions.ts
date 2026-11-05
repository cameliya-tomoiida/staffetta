"use server";
// 製品カード（⑦の(13)）の画面から使う処理。中身は src/lib/cards/store.ts。
import { revalidatePath } from "next/cache";
import type { CardInput } from "@/lib/cards/card";
import { approveCard, deleteTemplate, resetTemplates, saveCardInput, saveTemplate } from "@/lib/cards/store";
import type { CardTemplate } from "@/lib/cards/template";

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

/** 製品カードの形を保存（第3版） */
export async function saveTemplateAction(t: CardTemplate) {
  const errors = saveTemplate(t);
  if (errors.length) return { ok: false as const, error: errors.join("／") };
  revalidatePath("/cards");
  return { ok: true as const };
}

export async function deleteTemplateAction(id: string) {
  deleteTemplate(id);
  revalidatePath("/cards");
}

export async function resetTemplatesAction() {
  resetTemplates();
  revalidatePath("/cards");
}
