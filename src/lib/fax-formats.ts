import "server-only";
// FAX の様式の管理（管理画面の中身。画面の枠は②）。
// 様式は masters(name = "fax_formats", id = 取引先ID)。無効にすると、その取引先の次の FAX は「新しい様式」として承認待ちに戻る。
import { liveCustomers } from "@/lib/customers-live";
import { FAX_FORMATS } from "./db/hub-store";
import { deleteMaster, getMaster, getMasterHistory, listMaster, restoreMaster, upsertMasters, type HistoryRow } from "./db/masters";
import { readDb } from "./store";
import type { FaxFormatKind, FaxTemplate } from "./types";

export const formatKindLabel: Record<FaxFormatKind, string> = {
  weekly_table: "期間の表（品名×日付・週間／月間）",
  monthly_table: "1か月分の注文書（日付×品目の区分）",
  order_sheet: "発注書・発注伝票（1回分）",
  order_with_inspection: "発注書兼検収記録簿",
  corrected_print: "印字＋手書きの訂正",
  multi_page_set: "複数枚つづり（仮発注など）",
  change_notice: "変更・訂正の連絡票",
  handwritten_note: "手書きのメモ（様式なし）",
  other: "その他",
};

export interface FormatRow extends FaxTemplate {
  id: string;
  disabled?: boolean;
  customerName: string;
  itemCount: number;
  faxCount: number;
  lastFaxAt?: string;
}

export interface FormatDraft {
  faxId: string;
  receivedAt: string;
  customerId?: string;
  customerName?: string;
  title: string;
  layoutSummary: string;
  formatKind?: FaxFormatKind;
  pageNote?: string;
  items: { writtenName: string; productId: string }[];
}


/** 取引先の名前（マスタ・DB から） */
async function namer() {
  const list = await liveCustomers({ all: true });
  return (id: string) => list.find((c) => c.id === id)?.name ?? id;
}

/** 登録済みの様式（無効も含む）。取引先ごとの受信枚数・最後に届いた日も付ける */
export async function listFormats(): Promise<FormatRow[]> {
  const db = await readDb();
  const nameOf = await namer();
  const rows = await listMaster<FaxTemplate & { id: string; disabled?: boolean }>(FAX_FORMATS, { includeDisabled: true });
  return rows.map((r) => {
    const faxes = db.faxes.filter((f) => f.customerId === r.customerId);
    return {
      ...r,
      customerName: nameOf(r.customerId),
      itemCount: Object.keys(r.items ?? {}).length,
      faxCount: faxes.length,
      lastFaxAt: faxes.map((f) => f.receivedAt).sort().at(-1),
    };
  });
}

/** 承認待ちの下書き（初めての様式で届いた FAX） */
export async function listFormatDrafts(): Promise<FormatDraft[]> {
  const db = await readDb();
  const nameOf = await namer();
  return db.faxes
    .filter((f) => f.status === "template" && f.read)
    .map((f) => ({
      faxId: f.id,
      receivedAt: f.receivedAt,
      customerId: f.customerId,
      customerName: f.customerId ? nameOf(f.customerId) : f.read!.sender.name,
      title: f.read!.document_title,
      layoutSummary: f.read!.layout_summary,
      formatKind: f.read!.format_kind,
      pageNote: f.read!.page_note || undefined,
      items: [...new Map(f.read!.orders.flatMap((o) => o.lines).map((l) => [l.written_name, l.product_id])).entries()].map(([writtenName, productId]) => ({ writtenName, productId })),
    }));
}

export async function disableFormat(customerId: string, who: string) {
  await deleteMaster(FAX_FORMATS, customerId, who);
}

export async function enableFormat(customerId: string, who: string) {
  await restoreMaster(FAX_FORMATS, customerId, who);
}

/** 様式の中身を直す（品名の対応・型・メモ）。対応は「書類の品名 → 商品ID」 */
export async function updateFormat(
  customerId: string,
  patch: { items?: Record<string, string>; formatKind?: FaxFormatKind; pageNote?: string; note?: string; title?: string },
  who: string,
) {
  const cur = await getMaster<FaxTemplate & { id: string }>(FAX_FORMATS, customerId);
  if (!cur) throw new Error("様式が見つかりません");
  await upsertMasters(FAX_FORMATS, [{ ...cur, ...patch, id: customerId }], who);
}

export async function formatHistory(customerId: string): Promise<HistoryRow[]> {
  return getMasterHistory(FAX_FORMATS, customerId);
}
