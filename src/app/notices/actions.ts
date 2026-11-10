"use server";
// お客さんへのお知らせ（値上げなど）の画面の処理（作者 11/6 メモの 5）。管理者・事務だけ。送るのは人が OK を押したときだけ。
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth/current-user";
import { accountsExist } from "@/lib/staff";
import type { NoticeDraft, NoticeInput, RecipientPick } from "@/lib/notices/plan";
import { draftNotice, markDelivered, previewRecipients, saveNoticeDraft, sendNotice } from "@/lib/notices/store";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
async function mustOffice() {
  if (!accountsExist()) return;
  const u = await currentUser();
  if (u?.role !== "管理者" && u?.role !== "事務") throw new Error("お客さんへのお知らせは、管理者と事務の人が使えます");
}

export async function previewRecipientsAction(pick: RecipientPick) {
  try {
    await mustOffice();
    return { ok: true as const, list: await previewRecipients(pick) };
  } catch (e) {
    return { ok: false as const, error: msg(e) };
  }
}

export async function draftNoticeAction(input: NoticeInput) {
  try {
    await mustOffice();
    return { ok: true as const, ...(await draftNotice(input)) };
  } catch (e) {
    return { ok: false as const, error: msg(e) };
  }
}

export async function saveNoticeAction(input: NoticeInput, draft: NoticeDraft, by: "AI" | "決まりの文", pick: RecipientPick, who: string, id?: string) {
  try {
    await mustOffice();
    const n = await saveNoticeDraft(input, draft, by, pick, who, id);
    revalidatePath("/notices");
    return { ok: true as const, id: n.id };
  } catch (e) {
    return { ok: false as const, error: msg(e) };
  }
}

export async function sendNoticeAction(id: string, who: string) {
  try {
    await mustOffice();
    const n = await sendNotice(id, who);
    revalidatePath("/notices");
    return { ok: true as const, sent: n.recipients.filter((r) => r.status === "sent").length, fax: n.recipients.filter((r) => r.status === "fax_ready").length };
  } catch (e) {
    return { ok: false as const, error: msg(e) };
  }
}

export async function markDeliveredAction(id: string, customerId: string, who: string) {
  try {
    await mustOffice();
    markDelivered(id, customerId, who);
    revalidatePath("/notices");
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: msg(e) };
  }
}
