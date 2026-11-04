"use server";
// FAX の様式の管理の server action（画面の枠は②の管理画面）。
//   一覧          listFormatsAction()          → FormatRow[]（無効も含む。disabled: true が付く）
//   承認待ち      listFormatDraftsAction()     → FormatDraft[]（初めての様式で届いた FAX）
//   下書きを承認  approveTemplateAction（@/app/actions）を使う（確認画面と同じ）
//   無効にする    disableFormatAction(customerId, who)  … 次の FAX は承認待ちに戻る
//   戻す          enableFormatAction(customerId, who)
//   中身を直す    updateFormatAction(customerId, patch, who)  … 品名の対応・型・メモ
//   変更の記録    formatHistoryAction(customerId)
//   型の名前      formatKindLabelsAction()
import { revalidatePath } from "next/cache";
import {
  disableFormat, enableFormat, formatHistory, formatKindLabel, listFormatDrafts, listFormats, updateFormat,
} from "@/lib/fax-formats";
import type { FaxFormatKind } from "@/lib/types";

const need = (who: string) => {
  if (!who?.trim()) throw new Error("誰が変えたか（名前）を選んでください");
};

export async function listFormatsAction() {
  return listFormats();
}

export async function listFormatDraftsAction() {
  return listFormatDrafts();
}

export async function disableFormatAction(customerId: string, who: string) {
  need(who);
  await disableFormat(customerId, who);
  revalidatePath("/", "layout");
}

export async function enableFormatAction(customerId: string, who: string) {
  need(who);
  await enableFormat(customerId, who);
  revalidatePath("/", "layout");
}

export async function updateFormatAction(
  customerId: string,
  patch: { items?: Record<string, string>; formatKind?: FaxFormatKind; pageNote?: string; note?: string; title?: string },
  who: string,
) {
  need(who);
  await updateFormat(customerId, patch, who);
  revalidatePath("/", "layout");
}

export async function formatHistoryAction(customerId: string) {
  return formatHistory(customerId);
}

export async function formatKindLabelsAction() {
  return formatKindLabel;
}
