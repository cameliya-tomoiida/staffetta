import "server-only";
// メール（本文・PDF添付・Excel添付）を Claude で読み取る。
// 読むだけ。換算・修正はしない。変更・キャンセルのメールは intent で見分ける。
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { customers, products } from "@/data/master";

export const EMAIL_READER_MODEL = "claude-opus-5-5";

export const EmailReadSchema = z.object({
  intent: z
    .enum(["new", "change", "cancel", "not_order"])
    .describe("new=新しい注文 / change=前の注文の数量・日付の変更 / cancel=前の注文の取り消し / not_order=注文ではない（案内・請求など）"),
  sender: z.object({
    name: z.string().describe("差出人の会社・店名（署名・本文・注文書に書いてあるとおり）"),
    matched_customer_id: z.string().describe("得意先一覧の id のうち一致するもの。判断できなければ空文字"),
    evidence: z.string().describe("得意先を判定した根拠（差出人アドレス・署名・注文書の発注者欄など）"),
  }),
  refers_to: z.object({
    order_number: z.string().describe("変更・取消のとき、元の注文の番号（注文書No・発注番号など）。なければ空文字"),
    original_delivery_date: z.string().describe("変更・取消の対象になっている元の納品日 YYYY-MM-DD。分からなければ空文字"),
  }),
  order_number: z.string().describe("このメール／注文書の注文番号。なければ空文字"),
  orders: z.array(
    z.object({
      delivery_date: z.string().describe("納品日 YYYY-MM-DD"),
      delivery_place: z.string().describe("納品場所（店舗名・工場直送先など）。なければ空文字"),
      lines: z.array(
        z.object({
          written_name: z.string().describe("書いてある品名そのまま"),
          product_id: z.string().describe("商品一覧の id で一致するもの。推測なら一番近い候補、なければ空文字"),
          quantity: z.number().describe("書いてある数量そのまま。変更なら『変更後』の数量。取消なら0"),
          previous_quantity: z.number().describe("変更前の数量が書いてあればその数。なければ -1"),
          unit_written: z.string().describe("書いてある単位（個・枚・ケース・c/s・袋・P など）"),
          pieces_per_unit: z.number().describe("1単位あたりの個数（ケース20枚入なら20。個・枚の指定なら1。分からなければ1）"),
          confidence: z.number().describe("読み取りの確からしさ 0〜1"),
          attention: z.string().describe("人が確認すべき点（入数が不明・品名の対応が推測・本文と添付で数が違う など）。なければ空文字"),
          found_in: z.string().describe("どこに書いてあったか（『本文』または添付ファイル名）"),
        }),
      ),
    }),
  ),
  notes: z.string().describe("連絡事項の要約（急ぎ・直送依頼・電話済み など）。なければ空文字"),
});
export type EmailRead = z.infer<typeof EmailReadSchema>;

const SYSTEM = `あなたは中小のパン・ピザ工場で、取引先から届いた注文メールを読み取る係です。
読み取った結果は、工場のスタッフが元のメール・添付と見比べて確定します。あなたの役割は「書いてあるとおりに読む」ことと「人が確認すべき箇所に印を付ける」ことだけです。

守ること:
- 数量は書いてあるとおりに読む。ケース・袋を個数に直すなどの換算はしない（換算はシステムが行う）。入数が書いてあれば pieces_per_unit に入れる。
- 本文と添付の両方に注文がある場合は両方読む。同じ注文が重複して書いてあるなら1回だけ入れ、attention に「本文と添付に同じ内容」と書く。数が食い違うなら両方入れて attention に書く。
- 「変更」「訂正」「追加」「キャンセル」「取り消し」の連絡は intent を change / cancel にする。変更は「変更後の数量」を quantity に入れる。変更されない品は lines に入れない。
- 「追加」は前の注文に足すものなので intent=change にして、追加する数を quantity に入れ、attention に「追加分」と書く。
- 年の記載がない日付は、メールの受信日に最も近い未来の日付として解釈する。「明日」「来週月曜」なども受信日から日付に直し、attention に元の書き方を残す。
- 商品一覧との対応に少しでも推測が入るときは confidence を下げ、attention に理由を書く。
- 注文と関係のない署名・定型文・広告は無視する。`;

function masterText() {
  const cust = customers.map((c) => `${c.id}: ${c.name}${c.note ? `（${c.note}）` : ""}`).join("\n");
  const prod = products.map((p) => `${p.id}: ${p.name}（単位 ${p.unit}）`).join("\n");
  return `## 得意先一覧\n${cust}\n\n## 商品一覧\n${prod}`;
}

export type MailPart =
  | { kind: "text"; title: string; text: string }
  | { kind: "pdf"; title: string; base64: string };

export async function readEmail(input: {
  subject: string;
  from: string;
  date: string;
  parts: MailPart[];
}): Promise<{ read: EmailRead; model: string }> {
  const client = new Anthropic();
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const p of input.parts) {
    if (p.kind === "pdf") {
      content.push({ type: "text", text: `【添付PDF: ${p.title}】` });
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: p.base64 } });
    } else {
      content.push({ type: "text", text: `【${p.title}】\n${p.text}` });
    }
  }
  content.push({
    type: "text",
    text: `${masterText()}\n\n件名: ${input.subject}\n差出人: ${input.from}\n受信日時: ${input.date}\n\nこのメールを読み取ってください。`,
  });

  const response = await client.beta.messages.parse({
    model: EMAIL_READER_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: betaZodOutputFormat(EmailReadSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal") throw new Error("読み取りを断られました。手入力で登録してください。");
  if (!response.parsed_output) throw new Error(`読み取り結果を解釈できませんでした（stop_reason: ${response.stop_reason}）`);
  return { read: response.parsed_output, model: response.model };
}
