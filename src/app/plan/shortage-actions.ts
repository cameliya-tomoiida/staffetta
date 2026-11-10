"use server";
// 足りない材料の「発注」と「OK」（人が押したときだけ）。中身は画面から受け取らず、サーバーで計算し直す。
// 発注 → 仕入先の発注のしかたで下書きを作って保存（まだ送らない）。OK → 承認（「送り出し」に出る。FAX・サイト・メールは人が送る）
import { revalidatePath } from "next/cache";
import { allOrders } from "@/demo/all-orders";
import { getCompany } from "@/lib/company";
import { materialShortList, orderMail, urgentMaterialOrder, type OrderMail } from "@/lib/material-shortlist";
import { loadMasters } from "@/lib/masters/seed-db";
import { runPipeline } from "@/lib/pipeline";
import { approvePurchaseOrder, getPurchaseOrder, savePurchaseOrder } from "@/lib/purchase-store";

export interface PreparedOrder {
  poId: string;
  status: "draft" | "approved" | "sent";
  method: string;
  supplierName: string;
  siteName?: string;
  contact: string;
  deliveryDate: string;
  lines: { name: string; units: number; unitLabel: string }[];
  mail?: OrderMail;
  urgent: boolean;
}

type R = { ok: true; order: PreparedOrder } | { ok: false; error: string };

async function find(date: string, materialId: string) {
  const { orders } = await allOrders();
  const masters = await loadMasters();
  const r = runPipeline(orders, date, { masters });
  const row = materialShortList(r, masters).find((x) => x.materialId === materialId);
  if (!row) throw new Error("この材料はもう足りています（画面を開き直してください）");
  const sup = masters.suppliers.find((s) => s.id === row.supplierId);
  return { r, row, sup };
}

export async function prepareShortageOrderAction(date: string, materialId: string): Promise<R> {
  try {
    const { r, row, sup } = await find(date, materialId);
    const po = row.poId ? r.materialPurchaseOrders.find((p) => p.id === row.poId)! : urgentMaterialOrder(row, sup);
    await savePurchaseOrder(po, "製造計画の発注");
    const stored = (await getPurchaseOrder(po.id))!;
    const lines = stored.lines.map((l) => ({ name: l.name, units: l.units, unitLabel: l.unitLabel }));
    return {
      ok: true,
      order: {
        poId: po.id,
        status: stored.status,
        method: stored.method,
        supplierName: sup?.name ?? row.supplierName,
        ...(sup?.siteName ? { siteName: sup.siteName } : {}),
        contact: sup?.contact ?? "",
        deliveryDate: stored.deliveryDate,
        lines,
        ...(stored.method === "email" && sup ? { mail: orderMail(stored, sup, getCompany()) } : {}),
        urgent: !row.poId,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** OK（承認）。送るのは「発注の送信」で行う */
export async function approveShortageOrderAction(poId: string, who: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!who.trim()) throw new Error("OK する人を選んでください");
    await approvePurchaseOrder(poId, who);
    revalidatePath("/plan");
    revalidatePath("/outbound");
    revalidatePath("/purchase");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** OK 済みの発注書を、仕入先にメールで送る（メール送信の部品。鍵・試しの宛先の決まりのまま） */
export async function sendOrderMailAction(poId: string, who: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    if (!who.trim()) throw new Error("送る人を選んでください");
    const po = await getPurchaseOrder(poId);
    if (!po) throw new Error("発注書が見つかりません");
    if (po.status === "draft") throw new Error("先に OK を押してください");
    const m = await loadMasters();
    const sup = m.suppliers.find((s) => s.id === po.supplierId);
    if (!sup) throw new Error("仕入先がマスタにありません");
    const mail = orderMail(po, sup, getCompany());
    if (!mail.to) throw new Error("仕入先のメールアドレスが登録されていません");
    const { sendMail } = await import("@/lib/mail/send");
    const r = await sendMail({ to: [mail.to], subject: mail.subject, body: mail.body }, who);
    return r.ok ? { ok: true, message: `${mail.to} に送りました` } : { ok: false, error: r.error ?? "送れませんでした" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
