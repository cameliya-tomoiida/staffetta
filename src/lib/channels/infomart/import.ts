import "server-only";
// インフォマート（受注）の明細 CSV を取り込む。
// 列の名前は見出し行で探すので、実物の CSV で列の順番や数が違っても、見出しの言い方をマスタ「インフォマートの列名」に足せば読める（初期値は config.ts）。
// 実物の形は、作者がログインした画面で確認してから合わせる（docs/infomart-notes.md）。いまは架空の CSV で作っている。
import { customers } from "@/data/master";
import { findProduct } from "@/lib/catalog";
import { infomartHeaders } from "@/lib/masters/channel-settings";
import { INFOMART_HEADERS, type InfomartField } from "./config";
import { decodeText, guessProduct, parseCsv, saveImported, toIsoDate, type ImportedOrder } from "../common";
import { nowIso } from "@/lib/clock";

type Field = InfomartField;

export interface InfomartImportResult {
  fileName: string;
  rows: number;
  orderIds: string[];
  unknownItems: string[];
  unknownBuyers: string[];
}

export async function importInfomartCsv(buf: Uint8Array, fileName: string): Promise<InfomartImportResult> {
  const [head, ...rows] = parseCsv(decodeText(buf));
  if (!head) throw new Error("CSV が空です");
  const idx = {} as Record<Field, number>;
  const HEADERS = await infomartHeaders();
  for (const f of Object.keys(HEADERS) as Field[]) {
    idx[f] = head.findIndex((h) => (HEADERS[f] as readonly string[]).includes(h.trim()));
  }
  for (const need of ["slipNo", "deliveryDate", "itemName", "qty"] as Field[]) {
    if (idx[need] < 0) throw new Error(`CSV に「${HEADERS[need][0]}」の列がありません`);
  }
  const get = (r: string[], f: Field) => (idx[f] >= 0 ? (r[idx[f]] ?? "").trim() : "");

  const bySlip = new Map<string, { r: string[]; rowNo: number }[]>();
  rows.forEach((r, i) => {
    const s = get(r, "slipNo");
    if (s) bySlip.set(s, [...(bySlip.get(s) ?? []), { r, rowNo: i + 2 }]);
  });

  const unknownItems = new Set<string>();
  const unknownBuyers = new Set<string>();
  const list: ImportedOrder[] = [];
  for (const [slip, rs] of bySlip) {
    const first = rs[0].r;
    const buyerCode = get(first, "buyerCode");
    const customer = customers.find((c) => c.externalCode && c.externalCode === buyerCode);
    if (!customer) unknownBuyers.add(`${buyerCode} ${get(first, "buyerName")}`);
    list.push({
      id: `IM-${slip}`,
      customerId: customer?.id ?? "",
      deliveryDate: toIsoDate(get(first, "deliveryDate")),
      deliveryPlace: get(first, "placeName") || undefined,
      intent: "new",
      source: {
        channel: "infomart",
        refs: [{ kind: "csv", fileName, rowStart: Math.min(...rs.map((x) => x.rowNo)), rowEnd: Math.max(...rs.map((x) => x.rowNo)) }],
        externalId: slip,
        receivedAt: nowIso(),
        extra: { buyerCode, buyerName: get(first, "buyerName"), orderDate: toIsoDate(get(first, "orderDate")), placeCode: get(first, "placeCode") },
      },
      lines: rs.map(({ r }) => {
        const code = get(r, "itemCode");
        const name = get(r, "itemName");
        // インフォマートの商品コードは当社が登録したもの（＝当社の商品ID）。なければ品名から推測して要確認
        const byCode = findProduct(code);
        const g = byCode ? { productId: byCode.id, exact: true } : guessProduct(name);
        if (!byCode) unknownItems.add(`${code} ${name}`);
        const per = Number(get(r, "perUnit")) || 1;
        return {
          writtenName: [name, get(r, "spec")].filter(Boolean).join(" "),
          productId: g.productId,
          quantity: Number(get(r, "qty").replace(/,/g, "")) || 0,
          unitWritten: get(r, "unit") || "個",
          piecesPerUnit: per,
          confidence: byCode ? 1 : g.productId ? 0.6 : 0.3,
          attention: [
            byCode ? "" : `商品コード ${code || "（なし）"} が当社の商品にありません`,
            customer ? "" : `発注元 ${buyerCode} が得意先にありません`,
          ]
            .filter(Boolean)
            .join("・"),
          note: get(r, "note") || undefined,
        };
      }),
    });
  }
  const saved = await saveImported(list);
  return { fileName, rows: rows.length, orderIds: saved.ids, unknownItems: [...unknownItems], unknownBuyers: [...unknownBuyers] };
}

export { INFOMART_HEADERS };
