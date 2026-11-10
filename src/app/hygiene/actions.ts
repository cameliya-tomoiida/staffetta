"use server";
// 衛生管理（⑦の(21)）の画面から使う処理。中身は src/lib/hygiene/store.ts。
import { revalidatePath } from "next/cache";
import type { SheetDef, SheetRecord } from "@/lib/hygiene/sheets";
import { approveRecord, deleteManual, getSheet, resetSheets, saveRecord, saveSheet } from "@/lib/hygiene/store";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function saveRecordAction(sheetId: string, month: string, rec: SheetRecord, who: string) {
  try {
    saveRecord(sheetId, month, rec, who.trim() || "（現場）");
    revalidatePath("/hygiene");
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: msg(e) };
  }
}

export async function approveRecordAction(sheetId: string, month: string, who: string) {
  try {
    approveRecord(sheetId, month, who.trim());
    revalidatePath("/hygiene");
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: msg(e) };
  }
}

/** 項目の直し（点検清掃・毎日チェック） */
export async function saveSheetItemsAction(sheetId: string, items: NonNullable<SheetDef["items"]>, title?: string, rule?: string, weekdays?: number[]) {
  const cur = getSheet(sheetId);
  if (!cur) return { ok: false as const, error: "シートが見つかりません" };
  if (items.some((x) => !x.name.trim())) return { ok: false as const, error: "名前の無い項目があります" };
  saveSheet({ ...cur, items, ...(title?.trim() ? { title: title.trim() } : {}), ...(rule != null ? { rule } : {}), ...(weekdays ? { weekdays } : {}) });
  revalidatePath("/hygiene");
  return { ok: true as const };
}

export async function resetSheetsAction() {
  resetSheets();
  revalidatePath("/hygiene");
}

export async function deleteManualAction(id: string) {
  deleteManual(id);
  revalidatePath("/hygiene/manuals");
}

/** AI とのチャット（⑦の(24)）: 会話といまの下書きから、次の下書きと返事 */
export async function chatSheetAction(turns: { role: "user" | "assistant"; text: string }[], current: SheetDef | undefined, id: string) {
  try {
    const { chatSheet } = await import("@/lib/hygiene/ai-chat");
    return { ok: true as const, ...(await chatSheet(turns, current, id)) };
  } catch (e) {
    return { ok: false as const, error: msg(e) };
  }
}

/** AI と作ったシートを登録（同じ ID があれば置きかえ） */
export async function registerSheetAction(def: SheetDef) {
  if (!def.title.trim()) return { ok: false as const, error: "シートの名前がありません" };
  if (def.kind === "temp" && !def.temp) return { ok: false as const, error: "温度の基準がありません" };
  if ((def.kind === "clean" || def.kind === "check") && !def.items?.length) return { ok: false as const, error: "項目がありません" };
  if (def.kind === "log" && !def.columns?.length) return { ok: false as const, error: "記録の列がありません" };
  saveSheet({ ...def, active: true });
  revalidatePath("/hygiene");
  return { ok: true as const, id: def.id };
}
