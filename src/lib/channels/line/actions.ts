"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { lineConfig } from "./config";
import { verifyLiffIdToken } from "./client";
import { addCustomerAndLink, createLiffOrder, liffContext, linkUserToCustomer, notifyOrderConfirmed, unlinkUser } from "./orders";
import { saveCustomerSettings, type CustomerSettings } from "./customers";

// 画面から呼ぶサーバー関数（LIFFの注文画面・受注一覧の画面）。

/**
 * LIFFの画面のお客さんを確かめる。
 * - 本番: LIFFのIDトークンを LINE に確かめてもらう（なりすまし防止）
 * - デモ（LINEログインのチャネルID未設定）: 画面から渡された userId をそのまま使う
 */
async function whoIsLiffUser(auth: { idToken?: string; demoUserId?: string }) {
  // 社内PC（localhost・トンネルを通らない）からのデモは、架空のお客さん（U_demo_…）だけ受ける
  if (auth.demoUserId && !auth.idToken) {
    const h = await headers();
    const local = !h.has("cf-ray") && !h.has("cf-connecting-ip") && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h.get("host") ?? "");
    if (local && auth.demoUserId.startsWith("U_demo_")) return { userId: auth.demoUserId, displayName: undefined };
  }
  if (lineConfig.loginChannelId) {
    if (!auth.idToken) throw new Error("LINEアプリから開いてください");
    const v = await verifyLiffIdToken(auth.idToken);
    if (!v) throw new Error("LINEの本人確認ができませんでした");
    return { userId: v.userId, displayName: v.name };
  }
  if (!auth.demoUserId) throw new Error("お客さんが分かりません");
  return { userId: auth.demoUserId, displayName: undefined };
}

export type LiffAuth = { idToken?: string; demoUserId?: string };

export async function liffLoadAction(auth: LiffAuth) {
  const { userId } = await whoIsLiffUser(auth);
  return liffContext(userId);
}

export async function liffOrderAction(
  auth: LiffAuth,
  input: { deliveryDate: string; items: { productId: string; quantity: number }[]; claimedName?: string; repeat?: boolean },
) {
  const { userId, displayName } = await whoIsLiffUser(auth);
  const order = await createLiffOrder({ ...input, userId, displayName, claimedName: input.claimedName?.trim().slice(0, 40) || undefined });
  revalidatePath("/", "layout");
  return { orderId: order.id };
}

/** 受注一覧の画面用: 初回のLINEのお客さんを得意先にひも付ける（人が確認して押す） */
export async function linkLineUserAction(userId: string, customerId: string, who: string) {
  await linkUserToCustomer(userId, customerId, who);
  revalidatePath("/", "layout");
}

/**
 * 受注一覧の画面用: 人が LINE の注文を「確定」したあとに呼ぶ。お客さんへ「ご注文を確定しました」と内容を送る。
 * 確定ボタン以外からは呼ばないこと（自動送信しない）。
 */
export async function notifyLineConfirmedAction(orderId: string, who: string) {
  const r = await notifyOrderConfirmed(orderId, who);
  revalidatePath("/", "layout");
  return r;
}

/** 設定画面: LINE の人をスタッフとして登録する・外す */
export async function addStaffLineAction(input: { userId: string; name: string; allDanger: boolean }, who: string) {
  const { addStaffLine } = await import("./staff-alerts");
  await addStaffLine(input, who);
  revalidatePath("/", "layout");
}
export async function removeStaffLineAction(userId: string) {
  const { removeStaffLine } = await import("./staff-alerts");
  removeStaffLine(userId);
  revalidatePath("/", "layout");
}

/** LINE受付: 自動で確定した注文を、要確認に戻す */
export async function undoAutoConfirmAction(orderId: string, who: string) {
  const { undoAutoConfirm } = await import("./auto");
  await undoAutoConfirm(orderId, who);
  revalidatePath("/", "layout");
}

/** 管理画面: ひも付けを外す（人違いだったとき） */
export async function unlinkLineUserAction(userId: string, who: string) {
  await unlinkUser(userId, who);
  revalidatePath("/", "layout");
}

type SettingsInput = { name: string; channel: CustomerSettings["channel"]; cutoff: string; deliveryTime: string; course: string };

/** 管理画面: 新しい取引先として登録して、この LINE の人とひも付ける */
export async function addCustomerAndLinkAction(userId: string, input: SettingsInput, who: string) {
  const id = await addCustomerAndLink(userId, input, who);
  revalidatePath("/", "layout");
  return { customerId: id };
}

/** 管理画面: 取引先ごとの注文方法を保存 */
export async function saveCustomerSettingsAction(customerId: string, input: SettingsInput, who: string) {
  await saveCustomerSettings(customerId, input, who);
  revalidatePath("/", "layout");
}

/** 管理画面（②の AdminPage の onSave）: 取引先1件の登録・修正。おかしいところは日本語で返す */
export async function saveCustomerRowAction(row: Record<string, string | number | boolean | null | undefined>) {
  const { upsertCustomerRow } = await import("./customers");
  const r = await upsertCustomerRow(row, "事務");
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

/**
 * 管理画面（②の AdminPage の onImport）: 取引先の CSV 一括登録。⑤の枠（service.ts）で読み、③の customerDef で確かめる。
 * エラーが1件でもあれば保存しない（どの行がおかしいかを返す）。LINE のひも付け（lineUserIds）は CSV では変わらない。
 */
export async function importCustomersAction(fd: FormData): Promise<{ added: number; updated: number; errors: { line: number; message: string }[] }> {
  const file = fd.get("file");
  if (!(file instanceof File)) throw new Error("CSV ファイルを選んでください");
  const { previewUpload, applyUpload } = await import("@/lib/masters/service");
  const buf = new Uint8Array(await file.arrayBuffer());
  const p = await previewUpload("customers", buf, file.name);
  const errors = [
    ...p.fileErrors.map((message) => ({ line: 1, message })),
    ...p.rows.flatMap((r) => (r.kind === "error" ? r.errors.map((e) => ({ line: r.line, message: `${e.column}: ${e.message}` })) : [])),
  ];
  if (errors.length) return { added: 0, updated: 0, errors };
  if (!p.counts.add && !p.counts.update) return { added: 0, updated: 0, errors: [] };
  const r = await applyUpload("customers", buf, file.name, "事務", p.hash);
  revalidatePath("/", "layout");
  return { ...r, errors: [] };
}
