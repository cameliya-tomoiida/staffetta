import "server-only";
import { aiClient } from "@/lib/ai/client";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { allProducts } from "@/lib/catalog";

// LINEのトークに送られた文章（例:「明日 食パン6枚切り 3本、ロール 20個」）を Claude で読み取る。
// AIがやるのは「読み取り」と「要確認の印付け」まで。換算・修正はしない。

export const LINE_READER_MODEL = "claude-opus-5-5";

export const LineReadSchema = z.object({
  is_order: z.boolean().describe("注文（または注文の変更・追加・取消）の文章なら true。あいさつ・お礼・質問だけなら false"),
  orders: z.array(
    z.object({
      intent: z
        .enum(["new", "change", "cancel"])
        .describe("new=新しい注文 / change=前に出した注文の数・日・品の変更や追加 / cancel=前に出した注文の取消"),
      change_of_order_id: z
        .string()
        .describe("change・cancel のとき、このお客さんの最近の注文一覧のうち対象と思われる注文の id。分からなければ空文字"),
      delivery_date: z.string().describe("納品日 YYYY-MM-DD。書いてなければ受信日の翌日"),
      date_written: z.string().describe("文章に書いてあった日付の表現（明日・金曜・11/7 など）。なければ空文字"),
      lines: z.array(
        z.object({
          written_name: z.string().describe("文章に書いてある品名そのまま"),
          product_id: z.string().describe("商品一覧の id で一致するもの。自信がなければ一番近い候補、なければ空文字"),
          quantity: z.number().describe("書いてある数量（本・袋・ケースならその数のまま）。変更なら変更後の数。取消なら0"),
          unit_written: z.string().describe("書いてある単位（個・本・斤・袋・枚 など）。なければ空文字"),
          pieces_per_unit: z.number().describe("1単位あたりの個数。分からなければ 1"),
          confidence: z.number().describe("読み取りの確からしさ 0〜1"),
          attention: z.string().describe("人が確認すべき点（商品の対応が推測・単位があいまい・数が読みにくい など）。なければ空文字"),
        }),
      ),
    }),
  ),
  notes: z.string().describe("注文以外の連絡（変更・取消・時間の希望など）の要約。なければ空文字"),
});
export type LineRead = z.infer<typeof LineReadSchema>;

const SYSTEM = `あなたは中小のパン工場で、お客さん（喫茶店・小さな店・介護施設など。年配の方が多い）から LINE で届いた注文の文章を読み取る係です。
読み取った結果は、工場のスタッフが原文と見比べて確定します。あなたの役割は「書いてあるとおりに読む」ことと「人が確認すべき箇所に印を付ける」ことだけです。

守ること:
- 数量は書いてあるとおりに読む。本・袋を個数や斤に直すなどの換算はしない（換算は人とシステムが行う）。
- 話し言葉・略称・誤字（「ロール」「食パン6枚」「バタロ」など）は商品一覧の一番近い商品に対応付け、推測が入るときは confidence を 0.7 未満にして attention に理由を書く。
- 商品一覧の単位と書いてある単位が違う（例: 食パンを「本」で注文）ときは attention に書く。
- 「明日」「あさって」「金曜」などは受信日時（日本時間）を基準に日付にする。曜日だけのときは受信日以降で最も近いその曜日。日付が書いていないときは受信日の翌日にし、attention に「納品日の記載なし」と書く。
- 納品日が複数あるときは orders を納品日ごとに分ける。
- 「いつもの」「前と同じ」など中身が分からない注文は lines を空にし、notes に書く。
- 「さっきの注文」「明日の分」などの変更・追加・取消は intent を change / cancel にし、下の「このお客さんの最近の注文」から対象を選んで change_of_order_id に入れる。対象が分からないときは空文字にして attention に書く。
- change の lines には、変更・追加する品目だけを変更後の数で入れる（変わらない品目は入れない）。cancel で一部の品目だけ取消なら、その品目を数量0で入れる。全部の取消なら lines は空。
- 取消・変更の連絡は notes にも必ず書く。
- 最近の注文に「工場からの代わりの日の提案」がついていて、お客さんがそれに応じる返事（「お願いします」「それで」「○日でいいです」など）をしたときは、intent を change、change_of_order_id をその注文、delivery_date を提案の日にし、lines に提案の商品と数を入れる。提案と違う日・数を書いてきたら、書いてあるほうを読み、attention に「提案と違う」と書く。`;

export interface RecentOrderBrief {
  id: string;
  deliveryDate: string;
  status: string;
  receivedAt: string;
  summary: string;
  /** 確定の連絡で工場が出した代わりの日の提案（例: 超じゅくロール 6個入 2袋 → 2026-11-09） */
  altOffer?: string;
}

function masterText(known: Record<string, string>, recent: RecentOrderBrief[]) {
  const prod = allProducts().map((p) => `${p.id}: ${p.name}（単位 ${p.unit}）`).join("\n");
  const maps = Object.entries(known).map(([w, pid]) => `「${w}」→ ${pid}`).join("\n");
  const rec = recent.map((o) => `${o.id}: 納品日 ${o.deliveryDate}／${o.status}／受信 ${o.receivedAt}／${o.summary}${o.altOffer ? `／工場からの代わりの日の提案: ${o.altOffer}` : ""}`).join("\n");
  return `## 商品一覧\n${prod}\n\n## このお客さんについてスタッフが過去に承認した品名の対応（優先する）\n${maps || "（まだなし）"}\n\n## このお客さんの最近の注文（新しい順。変更・取消の対象さがしに使う）\n${rec || "（まだなし）"}`;
}

export async function readLineText(
  text: string,
  receivedAt: string,
  knownMappings: Record<string, string> = {},
  recentOrders: RecentOrderBrief[] = [],
): Promise<{ read: LineRead; model: string }> {
  // 1回の待ち時間は2分まで（SDK の初期値は10分）。やり直しは read-retry.ts が間をあけて行う
  const client = aiClient("LINE の読み取り", { timeout: 120_000 });
  const jst = new Date(receivedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "full", timeStyle: "short" });
  const response = await client.beta.messages.parse({
    model: LINE_READER_MODEL,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: betaZodOutputFormat(LineReadSchema) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `${masterText(knownMappings, recentOrders)}\n\n受信日時（日本時間）: ${jst}\n\n## LINEで届いた文章\n${text}`,
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("読み取りを断られました。原文を見て手入力してください。");
  if (!response.parsed_output) throw new Error(`読み取り結果を解釈できませんでした（stop_reason: ${response.stop_reason}）`);
  return { read: response.parsed_output, model: response.model };
}
