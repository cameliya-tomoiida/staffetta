import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { customers, products } from "@/data/master";
import { FaxReadSchema, type FaxRead } from "./types";

export const READER_MODEL = "claude-opus-5-5";

const SYSTEM = `あなたは中小のパン工場で、取引先から届いたFAX注文書を読み取る係です。
読み取った結果は、工場のスタッフが元のFAXと見比べて確定します。あなたの役割は「書いてあるとおりに読む」ことと「人が確認すべき箇所に印を付ける」ことだけです。

守ること:
- 数量は書いてあるとおりに読む。袋数を個数に直す・入数で割るなどの換算はしない（換算はシステムが行う）。
- 訂正の跡（二重線で消して書き直した数字など）は、書き直した後の数字を quantity にし、attention に「訂正あり 20→25」のように書く。
- 空欄の行は注文なし。数字が書いてある行だけを lines に入れる。
- 丸で選ぶ欄（白・黒など）は、丸が付いている方を written_name に含め、attention にも書く。
- 商品一覧との対応に少しでも推測が入るときは confidence を下げ、attention に理由を書く。
- 書類が逆さま・横向きなら rotation_degrees で示す（中身は正しい向きとして読む）。
- 年の記載がない日付は、受信日（FAX上端の日時）に最も近い未来の日付として解釈する。`;

function masterText(knownMappings: Record<string, Record<string, string>>) {
  const cust = customers.map((c) => `${c.id}: ${c.name}${c.fax ? `（FAX ${c.fax}）` : ""}`).join("\n");
  const prod = products
    .map((p) => `${p.id}: ${p.name}（${p.source === "make" ? "自社製造" : "仕入品"}・単位 ${p.unit}${p.pieceGram ? `・${p.pieceGram}g` : ""}）`)
    .join("\n");
  const maps = Object.entries(knownMappings)
    .map(([cid, m]) => Object.entries(m).map(([w, pid]) => `${cid} の「${w}」→ ${pid}`).join("\n"))
    .filter(Boolean)
    .join("\n");
  return `## 得意先一覧\n${cust}\n\n## 商品一覧\n${prod}\n\n## スタッフが過去に承認した品名の対応（この対応を優先する）\n${maps || "（まだなし）"}`;
}

export async function readFax(
  publicFile: string,
  receivedAt: string,
  knownMappings: Record<string, Record<string, string>>,
): Promise<{ read: FaxRead; model: string }> {
  const client = new Anthropic();
  const pdf = await fs.readFile(path.join(process.cwd(), "public", publicFile));

  const response = await client.beta.messages.parse({
    model: READER_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: betaZodOutputFormat(FaxReadSchema) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
          {
            type: "text",
            text: `${masterText(knownMappings)}\n\n受信日時: ${receivedAt}\n\nこのFAXを読み取ってください。`,
          },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("読み取りを断られました。手入力で登録してください。");
  }
  if (!response.parsed_output) {
    throw new Error(`読み取り結果を解釈できませんでした（stop_reason: ${response.stop_reason}）`);
  }
  return { read: response.parsed_output, model: response.model };
}
