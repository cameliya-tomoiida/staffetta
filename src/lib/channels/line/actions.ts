"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { lineConfig } from "./config";
import { verifyLiffIdToken } from "./client";
import { addCustomerAndLink, claimCustomerByCode, createLiffOrder, liffContext, linkUserToCustomer, notifyOrderConfirmed, unlinkUser } from "./orders";
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

/** お客さま番号＋FAX 番号の下4けたで、自分の会社につなぐ（つながると、その会社の商品・価格が出る） */
export async function liffClaimAction(auth: LiffAuth, code: string, last4: string): Promise<{ ok: true; customerName: string } | { ok: false; error: string }> {
  try {
    const { userId } = await whoIsLiffUser(auth);
    const h = await headers();
    const ip = h.get("cf-connecting-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
    const r = await claimCustomerByCode(userId, code, last4, ip);
    return { ok: true, customerName: r.customerName };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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

/**
 * お客さんがその日の納品書（PDF）を受け取る（担当者 11/7「納品される日・何が届くかを確かめて、納品書をダウンロードして、それを見ながら検品できるように」）。
 * つながっている取引先の、その日の確定した注文だけ。右の「検品」の欄で、届いた商品を確かめてもらう。
 */
/** 画面に出す納品書（PDF と同じ中身。担当者 11/7「控えの検品票なので、どう見えるかをその場で見せる」） */
export interface SlipView {
  title: string;
  no: string;
  date: string;
  to: string;
  from: string[];
  invoiceNo?: string;
  lines: { name: string; quantity: number; unit: string; unitPrice: number; amount: number }[];
  net: number;
  taxes: { rate: number; tax: number }[];
  total: number;
}

export async function liffSlipAction(auth: LiffAuth, date: string): Promise<{ ok: true; fileName: string; base64: string; view: SlipView } | { ok: false; error: string }> {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("日付が正しくありません");
    const { userId } = await whoIsLiffUser(auth);
    const [{ readLineState, customerIdForUser }, { deliveryDay }, { getCompany }, { makeSimplePdf }] = await Promise.all([
      import("./state"),
      import("@/lib/slips/store"),
      import("@/lib/company"),
      import("@/lib/channels/pdf"),
    ]);
    const customerId = customerIdForUser(await readLineState(), userId);
    if (!customerId) throw new Error("お客さま番号でつないでから使えます");
    const slip = (await deliveryDay(date, { customerId })).slips[0];
    if (!slip) throw new Error("この日の確定した注文はまだありません");
    const c = getCompany();
    const yen = (n: number) => n.toLocaleString("ja-JP");
    const md = `${Number(date.slice(0, 4))}年${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
    const pdf = await makeSimplePdf({
      title: "納品書",
      landscape: true,
      // 担当者 11/7「納品日は出すときに分かっている。宛先の下に今より大きく」「検品した人の欄はいらない」
      toSub: `納品日　${md}（${"日月火水木金土"[new Date(`${date}T00:00:00Z`).getUTCDay()]}）`,
      headerRight: [`伝票番号 ${slip.no}`, ...(c.invoiceNo ? [`登録番号 ${c.invoiceNo}`] : [])],
      to: [`${slip.customerName} 御中`],
      from: [c.name, c.address ? `${c.postalCode ? `〒${c.postalCode} ` : ""}${c.address}` : "", c.tel ? `TEL ${c.tel}` : "", c.fax ? `FAX ${c.fax}` : ""].filter(Boolean),
      lead: ["下記のとおり納品いたします。商品がお手元に届きましたら、右の「検品」の欄でご確認ください。"],
      table: {
        columns: [
          { label: "品名", width: 360 },
          { label: "数量", width: 60, align: "right" },
          { label: "単位", width: 45, align: "center" },
          { label: "単価", width: 70, align: "right" },
          { label: "金額", width: 85, align: "right" },
          { label: "検品", width: 60, align: "center" },
        ],
        rows: slip.lines.map((l) => [l.name, yen(l.quantity), l.unit, yen(l.unitPrice), yen(l.amount), "□"]),
      },
      notes: [
        `小計（税抜） ${yen(slip.totals.net)} 円`,
        ...slip.totals.byRate.map((r) => `消費税（${r.rate}%） ${yen(r.tax)} 円`),
        `合計（税込） ${yen(slip.totals.total)} 円`,
      ],
    });
    const view: SlipView = {
      title: "納品書",
      no: slip.no,
      date,
      to: slip.customerName,
      from: [c.name, c.tel ? `TEL ${c.tel}` : "", c.fax ? `FAX ${c.fax}` : ""].filter(Boolean),
      ...(c.invoiceNo ? { invoiceNo: c.invoiceNo } : {}),
      lines: slip.lines.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, amount: l.amount })),
      net: slip.totals.net,
      taxes: slip.totals.byRate.map((r) => ({ rate: r.rate, tax: r.tax })),
      total: slip.totals.total,
    };
    return { ok: true, fileName: `納品書_${date}.pdf`, base64: pdf.toString("base64"), view };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
