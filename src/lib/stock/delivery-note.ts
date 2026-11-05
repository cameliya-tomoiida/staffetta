import "server-only";
// B5（⑤）: 納品書（写真・PDF）を Claude で読み、発注書と照合する。
// Claude がするのは「読み取り」と「どの発注の行か」の対応付けまで。数が全部合えば自動で入荷、差がある行は人が直す（値は書き換えない）。
import Anthropic from "@anthropic-ai/sdk";
import { aiClient } from "@/lib/ai/client";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { PurchaseOrderLine } from "@/data/types";

export const DELIVERY_NOTE_MODEL = "claude-opus-5-5";

export const DeliveryNoteSchema = z.object({
  is_delivery_note: z.boolean().describe("納品書・納品伝票として読めたか"),
  supplier_name: z.string().describe("書いてある仕入先の名前（無ければ空）"),
  delivery_date: z.string().describe("納品日 YYYY-MM-DD（無ければ空）"),
  lines: z.array(
    z.object({
      written_name: z.string().describe("納品書に書いてある品名（そのまま）"),
      written_quantity: z.number().describe("納品書に書いてある数（そのまま）"),
      written_unit: z.string().describe("納品書に書いてある単位（袋・ケース・kg など。無ければ空）"),
      item_id: z.string().describe("発注書のどの行か（発注書の品目ID）。どれにも当たらなければ空"),
      quantity_in_order_units: z.number().describe("発注書の「量」の単位（kg・個 など）に直した数。直せなければ -1"),
      confidence: z.number().describe("この行の読み取りと対応付けの自信 0〜1"),
      attention: z.string().describe("気になる点（かすれ・訂正・単位が分からない など）。無ければ空"),
    }),
  ),
});
export type DeliveryNoteRead = z.infer<typeof DeliveryNoteSchema>;

const SYSTEM = `あなたはパン工場の事務の手伝いです。仕入先から届いた納品書（写真か PDF）を読み取ります。
- 書いてある値をそのまま読みます。推測で数を変えません。読めない所は attention に書き、confidence を下げます。
- 各行が、渡した発注書のどの行（品目ID）に当たるかを item_id に入れます。当たらなければ空にします。
- quantity_in_order_units は、発注書の「量」の単位（kg・個など）に直した数です。例：発注書が「25kg袋 ×2 = 50kg」で納品書が「2袋」なら 50。直せなければ -1。`;

export async function readDeliveryNote(input: { base64: string; mediaType: string; poLines: PurchaseOrderLine[]; supplierName: string }) {
  const client = aiClient("納品書の読み取り");
  const doc: Anthropic.Beta.BetaContentBlockParam =
    input.mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: input.base64 } }
      : { type: "image", source: { type: "base64", media_type: input.mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: input.base64 } };
  const po = input.poLines.map((l) => `${l.itemId}: ${l.name}　発注 ${l.units}${l.unitLabel}（量 ${l.quantity}）`).join("\n");
  const response = await client.beta.messages.parse({
    model: DELIVERY_NOTE_MODEL,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: betaZodOutputFormat(DeliveryNoteSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: [doc, { type: "text", text: `## 発注書（仕入先: ${input.supplierName}）\n${po}\n\nこの納品書を読み取り、発注書の行と対応付けてください。` }] }],
  });
  if (response.stop_reason === "refusal") throw new Error("読み取りを断られました。数を手で入れてください。");
  if (!response.parsed_output) throw new Error(`読み取り結果を解釈できませんでした（stop_reason: ${response.stop_reason}）`);
  return { read: response.parsed_output, model: response.model };
}

export interface NoteMatch {
  /** 全部の行が発注どおり（自動で入荷してよい） */
  allMatch: boolean;
  /** 入荷の数の案（発注書の行ごと。読めた数、読めなければ発注の数） */
  lines: { itemId: string; name: string; ordered: number; read?: number; status: "match" | "diff" | "missing"; note?: string }[];
  /** 発注書に無い行（納品書だけにある） */
  extra: string[];
}

/** 読み取りと発注書を照合する（純粋な計算） */
export function matchDeliveryNote(read: DeliveryNoteRead, poLines: PurchaseOrderLine[], minConfidence = 0.85): NoteMatch {
  const mat = poLines.filter((l) => l.itemType === "material" && l.quantity > 0);
  const lines = mat.map((l): NoteMatch["lines"][number] => {
    const hits = read.lines.filter((r) => r.item_id === l.itemId);
    if (!hits.length) return { itemId: l.itemId, name: l.name, ordered: l.quantity, status: "missing", note: "納品書に見当たりません" };
    const q = hits.reduce((s, r) => s + (r.quantity_in_order_units >= 0 ? r.quantity_in_order_units : NaN), 0);
    const unsure = hits.find((r) => r.confidence < minConfidence || r.attention.trim());
    if (!Number.isFinite(q)) return { itemId: l.itemId, name: l.name, ordered: l.quantity, status: "diff", note: "単位を直せませんでした" };
    const same = Math.abs(q - l.quantity) <= Math.max(0.001, l.quantity * 0.005);
    if (same && !unsure) return { itemId: l.itemId, name: l.name, ordered: l.quantity, read: q, status: "match" };
    return { itemId: l.itemId, name: l.name, ordered: l.quantity, read: q, status: "diff", note: same ? `読み取りに印があります（${unsure?.attention || "自信が低い"}）` : `発注 ${l.quantity} と 納品書 ${q} が違います` };
  });
  const extra = read.lines.filter((r) => !r.item_id || !mat.some((l) => l.itemId === r.item_id)).map((r) => `${r.written_name} ${r.written_quantity}${r.written_unit}`);
  return { allMatch: read.is_delivery_note && lines.every((l) => l.status === "match") && !extra.length, lines, extra };
}
