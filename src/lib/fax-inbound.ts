import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { FAX_INBOX_DIR, updateDb } from "./store";
import type { FaxDoc } from "./types";

export interface InboundFax {
  messageId: string;
  receivedAt: string; // ISO
  subject?: string;
  from?: string;
  attachments: { name: string; base64: string }[];
  via: "gmail" | "simulate";
}

/**
 * Gmail（GAS）などから届いたFAXを受信箱に入れる。
 * メッセージIDで二重取り込みを防ぐ。PDFは data/fax-inbox/ に保存（git には入らない）。
 * 返すのは新しく受信箱に入ったFAXのID。
 */
export async function receiveFax(input: InboundFax): Promise<{ duplicated: boolean; faxIds: string[] }> {
  const pdfs = input.attachments.filter((a) => a.name.toLowerCase().endsWith(".pdf") && a.base64);
  if (!pdfs.length) throw new Error("PDFの添付がありません");
  await fs.mkdir(FAX_INBOX_DIR, { recursive: true });
  return updateDb(async (db) => {
    if (db.importedMessageIds.includes(input.messageId)) return { duplicated: true, faxIds: [] };
    const faxIds: string[] = [];
    const stamp = Date.now().toString(36);
    for (const [i, a] of pdfs.entries()) {
      const id = `R${stamp}${i}`;
      const buf = Buffer.from(a.base64, "base64");
      if (buf.subarray(0, 5).toString() !== "%PDF-") throw new Error(`${a.name} はPDFではありません`);
      await fs.writeFile(path.join(FAX_INBOX_DIR, `${id}.pdf`), buf);
      const fax: FaxDoc = {
        id,
        file: `/api/fax-file/${id}`,
        via: input.via,
        messageId: input.messageId,
        subject: input.subject,
        receivedAt: input.receivedAt,
        label: input.subject || input.from || "（件名なし）",
        status: "new",
      };
      db.faxes.push(fax);
      faxIds.push(id);
    }
    db.importedMessageIds.push(input.messageId);
    return { duplicated: false, faxIds };
  });
}
