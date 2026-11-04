import "server-only";
// メール（.eml）を取り込んで、要確認の注文にする。
// - 本文・PDF添付・Excel添付のどれでも読む（Excel はセルの中身を表のテキストにして Claude に渡す）
// - 「変更」「キャンセル」は新しい注文（要確認）として入れ、元の注文は書き換えない。
//   Order.intent / changeOf で元の注文とひも付ける。人が確定するまで元の注文はそのまま。
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { simpleParser } from "mailparser";
import { customers } from "@/data/master";
import type { Order, SourceRef } from "@/data/types";
import { readDb } from "@/lib/store";
import { saveImported, type ImportedOrder } from "../common";
import { readEmail, type EmailRead, type MailPart } from "./reader";

export interface EmailImportResult {
  messageId: string;
  subject: string;
  intent: EmailRead["intent"];
  orderIds: string[];
  changeOf?: string;
  model: string;
  read: EmailRead;
}

/** Excel のシートを「行番号: セル | セル | …」のテキストにする（Claude が表として読めるように） */
export async function xlsxToText(buf: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  // exceljs の型が古い Buffer 型を要求するので変換して渡す
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const out: string[] = [];
  wb.eachSheet((ws) => {
    out.push(`--- シート「${ws.name}」 ---`);
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        const v = cell.value;
        let s: string;
        if (v == null) s = "";
        else if (v instanceof Date) s = v.toISOString().slice(0, 10);
        else if (typeof v === "object" && "result" in v) s = String((v as { result: unknown }).result ?? "");
        else if (typeof v === "object" && "richText" in v) s = (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
        else s = String(v);
        cells.push(s.trim());
      });
      if (cells.some(Boolean)) out.push(`${r}: ${cells.join(" | ")}`);
    });
  });
  return out.join("\n");
}

export async function emlToParts(eml: Buffer) {
  const mail = await simpleParser(eml);
  const parts: MailPart[] = [];
  const text = (mail.text ?? "").trim();
  if (text) parts.push({ kind: "text", title: "本文", text });
  const attachmentNames: string[] = [];
  for (const a of mail.attachments) {
    const name = a.filename ?? "添付";
    const lower = name.toLowerCase();
    if (a.contentType === "application/pdf" || lower.endsWith(".pdf")) {
      parts.push({ kind: "pdf", title: name, base64: a.content.toString("base64") });
      attachmentNames.push(name);
    } else if (lower.endsWith(".xlsx") || a.contentType.includes("spreadsheetml")) {
      parts.push({ kind: "text", title: `添付Excel: ${name}`, text: await xlsxToText(a.content) });
      attachmentNames.push(name);
    } else if (lower.endsWith(".csv") || a.contentType.startsWith("text/")) {
      parts.push({ kind: "text", title: `添付: ${name}`, text: a.content.toString("utf8") });
      attachmentNames.push(name);
    }
  }
  const messageId = mail.messageId ?? `eml-${createHash("sha1").update(eml).digest("hex").slice(0, 12)}`;
  const fromAddr = mail.from?.value?.[0];
  return {
    messageId,
    subject: mail.subject ?? "",
    from: fromAddr ? `${fromAddr.name ?? ""} <${fromAddr.address ?? ""}>` : "",
    date: (mail.date ?? new Date()).toISOString(),
    parts,
    attachmentNames,
  };
}

/** 変更・取消の元になる注文を探す（注文番号 → 得意先＋納品日）。見つからなければ undefined */
export function findOriginal(orders: Order[], customerId: string, read: EmailRead): Order | undefined {
  const no = read.refers_to.order_number.trim();
  const live = orders.filter((o) => o.status !== "cancelled" && (o.intent ?? "new") === "new");
  if (no) {
    const hit = live.find((o) => o.source.externalId === no);
    if (hit) return hit;
  }
  const date = read.refers_to.original_delivery_date || read.orders[0]?.delivery_date;
  if (customerId && date) {
    const cands = live.filter((o) => o.customerId === customerId && o.deliveryDate === date);
    // 確定済みを優先（人が確定したものに対する変更が多い）
    return cands.find((o) => o.status === "confirmed") ?? cands[0];
  }
  return undefined;
}

const safeId = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 10);

export async function importEml(eml: Buffer, fileName = "mail.eml"): Promise<EmailImportResult> {
  const mail = await emlToParts(eml);
  if (!mail.parts.length) throw new Error("本文も読める添付もありませんでした");
  const { read, model } = await readEmail(mail);
  const customerId = customers.some((c) => c.id === read.sender.matched_customer_id) ? read.sender.matched_customer_id : "";
  const base = `E${safeId(mail.messageId)}`;

  if (read.intent === "not_order") {
    return { messageId: mail.messageId, subject: mail.subject, intent: read.intent, orderIds: [], model, read };
  }

  const db = await readDb();
  const original = read.intent === "new" ? undefined : findOriginal(db.orders, customerId, read);

  const refs: SourceRef[] = [
    { kind: "email", messageId: mail.messageId, subject: mail.subject, from: mail.from },
    ...mail.attachmentNames.map((n): SourceRef => ({ kind: "email", messageId: mail.messageId, subject: mail.subject, from: mail.from, attachmentName: n })),
  ];
  const bodyText = mail.parts.find((p) => p.kind === "text" && p.title === "本文");

  const intent = read.intent as "new" | "change" | "cancel";
  const list: ImportedOrder[] = read.orders.map((ro, oi) => ({
    id: `${base}-${oi}`,
    intent,
    changeOf: original?.id,
    customerId,
    deliveryDate: ro.delivery_date,
    deliveryPlace: ro.delivery_place || undefined,
    source: {
      channel: "email",
      refs,
      externalId: read.order_number || undefined,
      receivedAt: mail.date,
      rawText: bodyText && bodyText.kind === "text" ? bodyText.text : undefined,
      extra: {
        fileName,
        ...(read.refers_to.order_number ? { refersToOrderNumber: read.refers_to.order_number } : {}),
        ...(read.notes ? { notes: read.notes } : {}),
        senderName: read.sender.name,
        senderEvidence: read.sender.evidence,
        model,
      },
    },
    lines: ro.lines.map((l) => ({
      writtenName: l.written_name,
      productId: l.product_id,
      quantity: l.quantity,
      unitWritten: l.unit_written,
      piecesPerUnit: l.pieces_per_unit || 1,
      confidence: l.confidence,
      attention: [
        l.attention,
        l.previous_quantity >= 0 ? `変更前 ${l.previous_quantity}` : "",
        read.intent !== "new" && !original ? "元の注文が見つかりません" : "",
      ]
        .filter(Boolean)
        .join("・"),
      note: l.found_in ? `出どころ: ${l.found_in}` : undefined,
    })),
  }));

  // 「全部キャンセル」で品目の行がないときも、取消の連絡として1件入れる（人が見て元の注文を取り消す）
  if (!list.length && read.intent === "cancel") {
    list.push({
      id: `${base}-0`,
      customerId,
      deliveryDate: read.refers_to.original_delivery_date || original?.deliveryDate || "",
      source: {
        channel: "email",
        refs,
        externalId: read.order_number || undefined,
        receivedAt: mail.date,
        rawText: bodyText && bodyText.kind === "text" ? bodyText.text : undefined,
        extra: { fileName, notes: read.notes, model },
      },
      lines: [],
      intent: "cancel",
      changeOf: original?.id,
    });
  }

  const saved = await saveImported(list);
  return { messageId: mail.messageId, subject: mail.subject, intent: read.intent, orderIds: saved.ids, changeOf: original?.id, model, read };
}
