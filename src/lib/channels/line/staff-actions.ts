"use server";
// 社内の画面（受注一覧・LINE の受付・取引先・設定）から呼ぶ LINE のサーバー関数（セキュリティの確認 11/7）。
// お客さんの LIFF の画面（/liff はログインなしで開ける）と同じファイルにあると、そこから呼べてしまうので分けた。どれも役割を見る。
import { revalidatePath } from "next/cache";
import { addCustomerAndLink, linkUserToCustomer, notifyOrderConfirmed, unlinkUser } from "./orders";
import { saveCustomerSettings, type CustomerSettings } from "./customers";
import type { Role } from "@/lib/auth/roles";

/** ログインを使っているときは、決まった役割の人だけ。操作した人の名前はログインの人にする */
async function allow(roles: Role[], who?: string): Promise<string> {
  const { accountsExist } = await import("@/lib/staff");
  if (!accountsExist()) return who ?? "";
  const { currentUser } = await import("@/lib/auth/current-user");
  const u = await currentUser();
  if (!u) throw new Error("ログインしてください");
  if (!roles.includes(u.role)) throw new Error("この役割では使えません");
  return u.name;
}
const OFFICE: Role[] = ["管理者", "事務"];

/** 受注一覧の画面用: 初回のLINEのお客さんを得意先にひも付ける（人が確認して押す） */
export async function linkLineUserAction(userId: string, customerId: string, who: string) {
  who = await allow(OFFICE, who);
  await linkUserToCustomer(userId, customerId, who);
  revalidatePath("/", "layout");
}

/**
 * 受注一覧の画面用: 人が LINE の注文を「確定」したあとに呼ぶ。お客さんへ「ご注文を確定しました」と内容を送る。
 * 確定ボタン以外からは呼ばないこと（自動送信しない）。
 */
export async function notifyLineConfirmedAction(orderId: string, who: string) {
  who = await allow([...OFFICE, "営業"], who);
  const r = await notifyOrderConfirmed(orderId, who);
  revalidatePath("/", "layout");
  return r;
}

/** 設定画面: LINE の人をスタッフとして登録する・外す */
export async function addStaffLineAction(input: { userId: string; name: string; allDanger: boolean }, who: string) {
  who = await allow(["管理者"], who);
  const { addStaffLine } = await import("./staff-alerts");
  await addStaffLine(input, who);
  revalidatePath("/", "layout");
}
export async function removeStaffLineAction(userId: string) {
  await allow(["管理者"]);
  const { removeStaffLine } = await import("./staff-alerts");
  removeStaffLine(userId);
  revalidatePath("/", "layout");
}

/** 管理画面: ひも付けを外す（人違いだったとき） */
export async function unlinkLineUserAction(userId: string, who: string) {
  who = await allow(OFFICE, who);
  await unlinkUser(userId, who);
  revalidatePath("/", "layout");
}

type SettingsInput = { name: string; channel: CustomerSettings["channel"]; cutoff: string; deliveryTime: string; course: string };

/** 管理画面: 新しい取引先として登録して、この LINE の人とひも付ける */
export async function addCustomerAndLinkAction(userId: string, input: SettingsInput, who: string) {
  who = await allow(OFFICE, who);
  const id = await addCustomerAndLink(userId, input, who);
  revalidatePath("/", "layout");
  return { customerId: id };
}

/** 管理画面: 取引先ごとの注文方法を保存 */
export async function saveCustomerSettingsAction(customerId: string, input: SettingsInput, who: string) {
  who = await allow(OFFICE, who);
  await saveCustomerSettings(customerId, input, who);
  revalidatePath("/", "layout");
}

/** 管理画面（②の AdminPage の onSave）: 取引先1件の登録・修正。おかしいところは日本語で返す */
export async function saveCustomerRowAction(row: Record<string, string | number | boolean | null | undefined>) {
  const who = (await allow(OFFICE)) || "事務";
  const { upsertCustomerRow } = await import("./customers");
  const r = await upsertCustomerRow(row, who);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

/**
 * 管理画面（②の AdminPage の onImport）: 取引先の CSV 一括登録。⑤の枠（service.ts）で読み、③の customerDef で確かめる。
 * エラーが1件でもあれば保存しない（どの行がおかしいかを返す）。LINE のひも付け（lineUserIds）は CSV では変わらない。
 */
export async function importCustomersAction(fd: FormData): Promise<{ added: number; updated: number; errors: { line: number; message: string }[] }> {
  const who = (await allow(OFFICE)) || "事務";
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
  const r = await applyUpload("customers", buf, file.name, who, p.hash);
  revalidatePath("/", "layout");
  return { ...r, errors: [] };
}

