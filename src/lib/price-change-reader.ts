// 仕入先からの「値上げのお知らせ」（FAX の PDF）を読む（作者 11/7）。仕入先・いつから・材料と新しい値段。
// 材料はマスタの名前と照らす（読めた名前 → 材料 ID）。値段は、マスタの単位（kg・袋など）に直した 1単位の円で返す。
import "server-only";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Masters } from "@/data/types";
import { aiClient } from "@/lib/ai/client";
import type { PriceChangeItem } from "./price-change";

export const PRICE_READER_MODEL = "claude-opus-5-5";

const Schema = z.object({
  isPriceChange: z.boolean().describe("材料・包材の値段を変えるお知らせなら true"),
  supplierName: z.string().describe("差出人の会社名"),
  effectiveDate: z.string().describe("いつから（YYYY-MM-DD）。年が書いていなければ、受け取った日のあとで一番近い日"),
  reason: z.string().describe("わけ（原料の値上がりなど）。無ければ空"),
  items: z.array(
    z.object({
      materialId: z.string().describe("下の材料の一覧から、いちばん合う材料の ID。合う物が無ければ空"),
      writtenName: z.string().describe("FAX に書いてある品名"),
      packLabel: z.string().describe("値段の単位（25kg袋・1kg・1缶 など）"),
      oldPrice: z.number().describe("前の値段（円）。書いていなければ 0"),
      newPrice: z.number().describe("新しい値段（円）"),
      kgPerPack: z.number().describe("その単位の量を、材料の在庫の単位に直した数（25kg袋で在庫の単位が kg なら 25。同じ単位なら 1）"),
    }),
  ),
});
export type PriceRead = z.infer<typeof Schema>;

/** 読めた値段 → マスタの 1単位の原価（25kg袋 5,000円 → 200円/kg）。マスタに無い材料は外す */
export function toItems(read: PriceRead, m: Pick<Masters, "materials">): PriceChangeItem[] {
  return read.items.flatMap((x) => {
    const mat = m.materials.find((y) => y.id === x.materialId) ?? m.materials.find((y) => y.name === x.writtenName);
    if (!mat || !(x.newPrice > 0)) return [];
    const per = x.kgPerPack > 0 ? x.kgPerPack : 1;
    const newCost = Math.round((x.newPrice / per) * 100) / 100;
    const oldCost = x.oldPrice > 0 ? Math.round((x.oldPrice / per) * 100) / 100 : mat.unitCost;
    return [{ materialId: mat.id, name: mat.name, unit: mat.unit, oldCost, newCost }];
  });
}

export async function readPriceChange(pdf: Buffer, receivedAt: string, m: Masters): Promise<PriceRead> {
  const list = m.materials.map((x) => `${x.id}\t${x.name}\t在庫の単位 ${x.unit}\t発注 ${x.orderUnitLabel}\t今の原価 ${x.unitCost}円/${x.unit}`).join("\n");
  const sups = m.suppliers.map((s) => `${s.id}\t${s.name}`).join("\n");
  const res = await aiClient("値上げのお知らせの読み取り").beta.messages.parse({
    model: PRICE_READER_MODEL,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { format: betaZodOutputFormat(Schema) },
    system: "パン工場に仕入先から届いた FAX を読みます。材料・包材の値段を変える（値上げ・値下げ）お知らせなら、品名・前と新しい値段・いつからを読み取ります。値段や日付は書いてある物だけを使い、作らないでください。",
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
          { type: "text", text: `## 材料の一覧\n${list}\n\n## 仕入先の一覧\n${sups}\n\n受け取った日時: ${receivedAt}\n\nこの FAX を読んでください。` },
        ],
      },
    ],
  });
  if (!res.parsed_output) throw new Error(`読み取れませんでした（${res.stop_reason}）`);
  return res.parsed_output;
}
