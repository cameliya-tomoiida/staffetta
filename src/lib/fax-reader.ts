import "server-only";
import { aiClient } from "@/lib/ai/client";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { promises as fs } from "node:fs";
import { faxFilePath } from "./store";
import { allProducts, withMasters } from "./catalog";
import type { Masters } from "@/data/types";
import { FaxReadSchema, type FaxRead } from "./types";
import { kvGet } from "./db/sqlite";

/** 工場の「日替わりロール予定表」（曜日 → 商品。月分の注文書の下に印刷している表）。kv daily_roll_schedule で直せる。
 *  書類に予定表が写っていないときに、日替わりロールの欄の商品を決めるのに使う */
export const DEFAULT_DAILY_ROLLS: Record<string, string> = { 月: "ミルクロール", 火: "ロールパン", 水: "レーズンパン", 木: "クロロール", 金: "コッペパン" };
export const dailyRollSchedule = (): Record<string, string> => kvGet<Record<string, string>>("daily_roll_schedule") ?? DEFAULT_DAILY_ROLLS;

export const READER_MODEL = "claude-opus-5-5";

const SYSTEM = `あなたは中小のパン工場で、取引先から届いたFAX注文書を読み取る係です。
読み取った結果は、工場のスタッフが元のFAXと見比べて確定します。あなたの役割は「書いてあるとおりに読む」ことと「人が確認すべき箇所に印を付ける」ことだけです。

守ること:
- 数量は書いてあるとおりに読む。袋数を個数に直す・入数で割るなどの換算はしない（換算はシステムが行う）。
- 訂正の跡（二重線で消して書き直した数字など）は、書き直した後の数字を quantity にし、attention に「訂正あり 20→25」のように書く。
- 空欄の行は注文なし。数字が書いてある行だけを lines に入れる。
- 丸で選ぶ欄（白・黒など）は、丸が付いている方を written_name に含め、attention にも書く。
- 商品一覧との対応に、本当に迷う推測が入るときは confidence を下げ、attention に理由を書く（例: 書いてある品名に当てはまる商品が2つ以上ある、入数や規格が商品一覧と合わない）。「ピザ生地 23センチ（クラスト）」→「ピザクラスト 23cm」のように言い換えだけで1つに決まるものは推測に数えない。

印（attention・confidence）の付け方:
- attention は「この行は、人が元のFAXを見て確かめないと危ない」ときだけ書く。画面では attention がある行が黄色になり、スタッフはそこだけを見る。印が多すぎると、本当に危ない行が埋もれる。
- 書くもの: 訂正の跡、丸で選ぶ欄、字の形が実際にまぎらわしい数字（どちらにも読める形のときだけ。読めた数字に一般的な注意は書かない）、かすれ・欠け、本当に迷う商品の対応。
- 書かないもの: 使用日と納品日の関係、仮発注・本発注の説明、変更前の数（previous_quantity に入れる）、前回の数、単位の言い換え、換算の話、FAX全体に関わる説明。これらは notes に1回だけ書く。
- confidence: はっきり読めて商品も1つに決まる行は 0.95 以上。字や対応に迷いがある行だけ下げる（0.85 未満は「念のため見る」、0.6 未満は「かならず見比べる」として画面に出る）。
- 書類が逆さま・横向きなら rotation_degrees で示す（中身は正しい向きとして読む）。
- 年の記載がない日付は、受信日（FAX上端の日時）に最も近い未来の日付として解釈する。
- 「納品日」と「使用日」が両方あるときは、納品日を delivery_date にする。

FAXの種類（kind）の見分け方:
- 注文書・発注書 → order。「仮発注」「予定数」「内示」と書いてあれば provisional_order。
- 「変更」「訂正」「キャンセル」など、既に出した注文を直す内容 → change。変更前の数が書いてあれば previous_quantity に入れ、quantity は変更後の数にする。
- こちら（工場）が仕入先に出した発注への返事（注文請書・納期回答・在庫切れの連絡など）→ supplier_reply。lines は空でよい。
- 広告・キャンペーン・営業案内など注文と関係ないもの → not_order。lines は空でよい。
- 新しく見る様式でも、layout_summary に様式の特徴をまとめる（あとで人が承認して、この取引先の様式として登録する）。
- 「発注なし」「今週はなし」とだけ書いたFAXも order とし、lines は空、notes にそのことを書く（人が受け取りを確認できるように）。

様式の型（format_kind）の見分け方（実物によくある形）:
- weekly_table: 行が品名、列が日付（週間・月間の注文表）。日付の列ごとに orders を分ける。
- monthly_table: 1か月分の注文書（保育園・こども園に多い）。行が日付（1〜31日・左右2段のこともある）、列が品目の区分（食パン・コッペパン・日替わりロール・その他・「えくぼシリーズ」「パンメーカー商品・カステラ等」など、取引先ごとに違う）。
  - 月は見出しの「◯月分」から（欠けていれば、曜日の並びと受信日から決める）。数字が書いてある日ごとに orders を分ける。斜線・空欄の日は注文なし。
  - 品目の区分の欄に商品名が手書きされていれば（例: えくぼシリーズの欄に「スイート」）、区分と合わせて written_name にする（「えくぼシリーズ スイート」）。
  - 「日替わりロール」の欄の数は、書類の「日替わりロール予定表」（曜日 → 商品。例: 月 ミルクロール・火 ロールパン・水 レーズンパン・木 クロロール・金 コッペパン）で、その日の曜日の商品にする。written_name は「日替わりロール（木）クロロール」のように、曜日と決めた商品を書く。予定表がこの書類に無いときは、下の「工場の日替わりロール予定表」で決める。どちらにも無い曜日なら「日替わりロール（土）」とし、attention に「日替わりロールの商品を確かめる」と書く。
  - 「個包装」「1本包装」のような包装の指定は、品名に入れない。その行の attention に「個包装の指定」のように書く（作り方が変わるので、人が見落とさないように）。書類全体への指定（「※食パン1本包装で」など）は notes に書く。
- 「8×46」「6×60」のような「A×B」は、入数×袋数（A個入りを B 袋）。quantity=B、pieces_per_unit=A、unit_written="袋" にする（468 のように続けて読まない）。
- 「20食」「195本」「215本」のような「食」「本」も、書いてあるまま unit_written に入れ、pieces_per_unit は 1 にする（何個にあたるかはシステムの取引先の決まりで換算する）。
- order_sheet: 1回分の発注書・発注伝票。納品日が1つ（行ごとに納品日が違えば、納品日ごとに orders を分ける）。
- order_with_inspection: 「発注書兼検収記録簿」「検収記録簿」。病院・給食で多い。発注数の欄だけを読み、検収数・品温・異常の有無・サインの欄は読まない（受け取る側の記録欄なので空でよい）。
- corrected_print: 印字された発注書に、手書きで数を書き込んだり訂正したりしたもの。手書きが優先。
- multi_page_set: 「1/13」のような複数枚つづり。全ページで1件として読み、page_note にページの関係を書く。
- change_notice: 既に出した注文の数・日付を変える連絡票。
- handwritten_note: 決まった様式のない手書きのメモ。字の形がまぎらわしい（1と7、0と6 など）ときだけ confidence を下げ、どちらに読めるかを attention に書く。
- 単位（個・袋・P（パック）・c/s（ケース）・枚切り・食・本）は書いてあるまま unit_written に入れる。「3枚入4袋」のような入数は pieces_per_unit に入れる。`;

// 得意先・商品・仕入先は、マスタ（DB。画面で直した値）から。見本の固定の一覧ではない（3100 の本当の取引先を読めるように）
function masterText(knownMappings: Record<string, Record<string, string>>, m: Masters) {
  const cust = m.customers.filter((c) => c.active !== false).map((c) => `${c.id}: ${c.name}${c.fax ? `（FAX ${c.fax}）` : ""}`).join("\n");
  const prod = withMasters(m, () => allProducts())
    .map((p) => `${p.id}: ${p.name}（単位 ${p.unit}${p.spec ? `・${p.spec.kind === "buy" ? "仕入品" : "自社製造"}` : ""}）`)
    .join("\n");
  const sup = m.suppliers.map((x) => `${x.id}: ${x.name}`).join("\n");
  const maps = Object.entries(knownMappings)
    .map(([cid, m]) => Object.entries(m).map(([w, pid]) => `${cid} の「${w}」→ ${pid}`).join("\n"))
    .filter(Boolean)
    .join("\n");
  const rolls = Object.entries(dailyRollSchedule()).map(([d, n]) => `${d}: ${n}`).join("・");
  return `## 工場の日替わりロール予定表（書類に予定表が写っていないときは、これで曜日の商品を決める）
${rolls}

## 得意先一覧（工場にパンを注文するお客さん）\n${cust}\n\n## 仕入先一覧（工場が材料・仕入品を発注する相手。ここからのFAXは注文ではない）\n${sup}\n\n## 商品一覧\n${prod}\n\n## スタッフが過去に承認した品名の対応（この対応を優先する）\n${maps || "（まだなし）"}`;
}

export async function readFax(
  publicFile: string,
  receivedAt: string,
  knownMappings: Record<string, Record<string, string>>,
  recentFixes: string[] = [],
): Promise<{ read: FaxRead; model: string }> {
  return readFaxBytes(await fs.readFile(faxFilePath(publicFile)), receivedAt, knownMappings, recentFixes);
}

/** PDF の中身から読み取る（受信箱を通さずに試すときにも使う） */
export async function readFaxBytes(
  pdf: Buffer,
  receivedAt: string,
  knownMappings: Record<string, Record<string, string>>,
  recentFixes: string[] = [],
): Promise<{ read: FaxRead; model: string }> {
  const client = aiClient("FAX の読み取り");
  const masters = await (await import("./masters/seed-db")).loadMasters();

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
            text: `${masterText(knownMappings, masters)}\n\n## スタッフが最近直した例（同じ間違いをしないための参考。値をそのまま使わず、読み方の参考にする）\n${recentFixes.join("\n") || "（まだなし）"}\n\n受信日時: ${receivedAt}\n\nこのFAXを読み取ってください。`,
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
