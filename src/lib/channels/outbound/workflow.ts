import "server-only";
// 発注の送り出しの流れ: 下書き → 人が承認 → 送り先ごとの出力ができる → 人が送る → 人が「送った」を押す
// - 発注書の状態（下書き・承認・送信済み）は③の purchase-store（data/db.json の purchaseOrders）だけに持つ。ここでは独自の状態を持たない
// - 承認ボタンを押すまで、何も作らない・送らない
// - 送信そのものは人がする（FAX は複合機・メールはメールソフト・サイトは画面で確定）
// - 出力ファイル（PDF・CSV・メール下書き）は data/outbound/<発注書ID>/ に置く。中身は承認済みの発注書から毎回同じに作れる
import { promises as fs } from "node:fs";
import path from "node:path";
import type { PurchaseOrder } from "@/data/types";
import {
  approvePurchaseOrder, getPurchaseOrder, listPurchaseOrders, markSent as markSentInStore, savePurchaseOrders,
  type StoredPurchaseOrder,
} from "@/lib/purchase-store";
import { emailDraft, entryCsv, purchasePdf, type PoLike } from "./render";
import { isSiteMethod } from "./sites";
import { findSupplier } from "@/lib/catalog";

// 試しのサーバー（見本の DB）では HUB_OUTBOUND_DIR で別の置き場に（本物の出力を上書きしないように。11/7）
const DIR = process.env.HUB_OUTBOUND_DIR || path.join(process.cwd(), "data", "outbound");

export type OutputKind = "fax_pdf" | "pdf" | "email_eml" | "site_csv";

export interface OutputFile {
  kind: OutputKind;
  fileName: string;
  label: string;
}

export interface OutboundRecord {
  po: StoredPurchaseOrder;
  outputs: OutputFile[];
  /** FAX で送る発注書で、承認済み・未送信 = 送信待ち */
  faxWaiting: boolean;
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9._\-ぁ-んァ-ヶ一-龠ー]/g, "_");
const dirOf = (poId: string) => path.join(DIR, safe(poId));

export function outputPath(poId: string, fileName: string) {
  const p = path.join(dirOf(poId), safe(fileName));
  if (!p.startsWith(DIR)) throw new Error("bad path");
  return p;
}

const pdfName = (po: PurchaseOrder) => `発注書_${po.id}.pdf`;

/** 承認済みの発注書から、送り先ごとの出力ファイルを作る（何度呼んでも同じものができる） */
async function writeOutputs(po: PoLike): Promise<void> {
  const dir = dirOf(po.id);
  await fs.mkdir(dir, { recursive: true });
  const pdf = await purchasePdf(po);
  await fs.writeFile(path.join(dir, safe(pdfName(po))), pdf);
  if (po.method === "email") {
    const eml = await emailDraft(po, pdf);
    await fs.writeFile(path.join(dir, safe(eml.fileName)), eml.content);
  }
  if (isSiteMethod(po.method)) {
    const csv = entryCsv(po);
    if (csv) await fs.writeFile(path.join(dir, safe(csv.fileName)), csv.content);
  }
}

async function outputsOf(po: PurchaseOrder): Promise<OutputFile[]> {
  let files: string[] = [];
  try {
    files = await fs.readdir(dirOf(po.id));
  } catch {
    return [];
  }
  return files.sort().map((f): OutputFile => {
    if (f.endsWith(".eml")) return { kind: "email_eml", fileName: f, label: "メール下書き（添付つき）" };
    if (f.endsWith(".csv")) return { kind: "site_csv", fileName: f, label: "サイト取り込み用 CSV" };
    return po.method === "fax" ? { kind: "fax_pdf", fileName: f, label: "FAX 用 PDF" } : { kind: "pdf", fileName: f, label: "発注書 PDF（控え）" };
  });
}

/** 発注の送信の一覧。承認済みなのに出力がないもの（/purchase で承認された等）は、ここで出力を作る */
export async function listOutbound(): Promise<OutboundRecord[]> {
  const pos = (await listPurchaseOrders()).filter((p) => p.lines.some((l) => l.units > 0));
  const out: OutboundRecord[] = [];
  for (const po of pos) {
    let outputs = await outputsOf(po);
    if (po.status !== "draft" && !outputs.length) {
      await writeOutputs(po);
      outputs = await outputsOf(po);
    }
    out.push({ po, outputs: po.status === "draft" ? [] : outputs, faxWaiting: po.method === "fax" && po.status === "approved" });
  }
  const rank = { approved: 0, draft: 1, sent: 2 } as const;
  return out.sort((a, b) => rank[a.po.status] - rank[b.po.status] || a.po.deliveryDate.localeCompare(b.po.deliveryDate) || a.po.id.localeCompare(b.po.id));
}

/** 下書きを③の保存先に入れる（承認済み・送信済みは上書きされない） */
export async function receiveDrafts(drafts: PoLike[], who = "system") {
  return savePurchaseOrders(drafts.filter((d) => d.lines.some((l) => l.units > 0)), who);
}

/** 承認（人が押したときだけ呼ぶ）。③の approvePurchaseOrder で承認してから、出力を作る。送信はしない */
export async function approvePo(poId: string, who: string) {
  const rec = await approvePurchaseOrder(poId, who);
  await writeOutputs(rec);
  return rec;
}

// ───────── 発注の送信（担当者 11/7「送った、ではなく送信する。押すと確認の画面、本当に送信するで初めて送る」） ─────────

const METHOD: Record<string, string> = { fax: "FAX", email: "メール", phone: "電話" };

export interface SendPreview {
  poId: string;
  supplierName: string;
  method: string;
  /** 宛先（メールアドレス・FAX 番号）。分からなければ "" */
  to: string;
  deliveryDate: string;
  lines: { name: string; units: number; unitLabel: string }[];
  /** system = 確認のあとシステムが送る／manual = 出力（PDF・下書き・CSV）を作るだけで、送るのは人 */
  plan: "system" | "manual";
  /** 確認の画面に出す一言 */
  message: string;
}

/** システムが送れるか（メール: Microsoft のメールがつながっていて、送信の鍵が ON、宛先がある）。FAX の送信の口はまだ無い */
async function systemSendable(po: PurchaseOrder): Promise<{ ok: boolean; to: string; why: string }> {
  const sup = findSupplier(po.supplierId);
  const contact = (sup as { contact?: string } | undefined)?.contact ?? "";
  if (po.method === "email") {
    const to = /@/.test(contact) ? contact : "";
    const { mailStatus } = await import("@/lib/mail/graph");
    const { isOn } = await import("@/lib/settings/features");
    if (!to) return { ok: false, to, why: "メールアドレスが未登録" };
    if (!mailStatus().connected) return { ok: false, to, why: "メールがつながっていない" };
    if (!isOn("notice_send")) return { ok: false, to, why: "送信の鍵が OFF" };
    return { ok: true, to, why: "" };
  }
  return { ok: false, to: contact, why: po.method === "fax" ? "FAX の送信の口がまだ無い" : "" };
}

export async function sendPreview(poId: string): Promise<SendPreview> {
  const po = await getPurchaseOrder(poId);
  if (!po) throw new Error("発注書が見つかりません");
  if (po.status === "draft") throw new Error("先に承認してください");
  if (po.status === "sent") throw new Error("この発注書はもう送信済みです");
  const s = await systemSendable(po);
  const name = String((po as PoLike).supplierName ?? findSupplier(po.supplierId)?.name ?? po.supplierId);
  const method = isSiteMethod(po.method) ? "サイトに入力" : (METHOD[po.method] ?? po.method);
  const message = s.ok
    ? `「本当に送信する」を押すと、${s.to} にメールで送ります（発注書の PDF を添付）。`
    : po.method === "email"
      ? `この仕入先にはメールの下書きを作ります。送るのは人が行います（${s.why}）。`
      : po.method === "fax"
        ? "この仕入先には FAX 用 PDF を作ります。送るのは人が行います。"
        : isSiteMethod(po.method)
          ? "この仕入先には、サイトに入力する CSV（入力用リスト）を作ります。入力は人が行います。"
          : "送るのは人が行います（電話など）。";
  return { poId, supplierName: name, method, to: s.to, deliveryDate: po.deliveryDate, lines: po.lines.filter((l) => l.units > 0).map((l) => ({ name: l.name, units: l.units, unitLabel: l.unitLabel })), plan: s.ok ? "system" : "manual", message };
}

/** 「本当に送信する」。送れるならシステムが送って送信済みに。送れないなら出力を作って送信済み（手で送る）に。誰がいつ押したかを残す */
export async function sendPo(poId: string, who: string): Promise<{ message: string }> {
  if (!who.trim()) throw new Error("送信する人の名前を選んでください");
  const po = await getPurchaseOrder(poId);
  if (!po) throw new Error("発注書が見つかりません");
  if (po.status !== "approved") throw new Error(po.status === "sent" ? "この発注書はもう送信済みです" : "先に承認してください");
  await writeOutputs(po);
  const s = await systemSendable(po);
  if (s.ok) {
    const pdf = await purchasePdf(po);
    const mail = await emailDraft(po, pdf);
    const { sendMail } = await import("@/lib/mail/send");
    const r = await sendMail({ to: [s.to], subject: mail.subject, body: mail.text, attachments: [{ name: `発注書_${po.id}.pdf`, contentType: "application/pdf", base64: pdf.toString("base64") }] }, who);
    if (!r.ok) throw new Error(`メールを送れませんでした（${r.error ?? "不明"}）。送信済みにはしていません`);
    await markSentInStore(poId, who, `メールで送信（システム・${s.to}）`);
    return { message: `${s.to} にメールで送信しました` };
  }
  const how = po.method === "fax" ? "FAX 用 PDF を作りました（送るのは人）" : po.method === "email" ? "メールの下書きを作りました（送るのは人）" : isSiteMethod(po.method) ? "入力用の CSV を作りました（入力は人）" : `${METHOD[po.method] ?? "人"}で送信（人）`;
  await markSentInStore(poId, who, how);
  return { message: `送信済みにしました（${how}）` };
}

/** 人が送ったあとに押す「送った」。③の markSent を呼ぶ。これを押すまで sent にはならない */
export async function markSent(poId: string, who: string, note?: string) {
  if (!who.trim()) throw new Error("送った人の名前を入れてください");
  const po = await getPurchaseOrder(poId);
  if (!po) throw new Error("発注書が見つかりません");
  const how = { fax: "FAX", email: "メール", phone: "電話" } as Record<string, string>;
  return markSentInStore(poId, who, note ?? `${how[po.method] ?? "サイト"}で送信（人）`);
}
