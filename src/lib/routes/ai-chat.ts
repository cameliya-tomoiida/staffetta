import "server-only";
// 配送コースの見直しの AI（⑦の(29)）。Claude を呼ぶのは①の aiClient（月の上限・使った量の記録）。
//   readNotes     = 配送メモ（置き場所・注意・メモ）を読んで、計算の条件にする
//   chatRoutes    = 「〇〇さんは11時までに帰りたい」などの話を、条件と計算の決まりに直す
//   explainResult = 計算の結果を、今のコースと比べてことばで説明する
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { aiClient } from "@/lib/ai/client";
import { apiKey } from "@/lib/ai/settings";
import { AiRuleSchema, type AiRule } from "./ai-rules";

export const ROUTE_AI_MODEL = "claude-opus-5-5";
export const hasRouteAi = () => !!apiKey();
const FEATURE = "配送コースの AI";
const WD = "日月火水木金土";

const BASE = `あなたは食品工場（パン・ピザ）の配送コースの係です。毎朝、自社のトラックで取引先に納品します。
計算の条件の種類:
- window: その先に着く時間の希望（from〜to, HH:MM）。「10時まで」→ to=10:00、「9時以降」→ from=09:00
- service: その先の納品にかかる分（「搬入に時間がかかる」「階段で運ぶ」など。分がわからなければ作らない）
- closed: その先に行かない曜日（0=日〜6=土）。「月曜休み」→ [1]
- backBy: 〇時までに工場に帰るコースを1つ（label=だれのコースか）。2人なら2つ
- together: 同じコースにする先（2件以上）
- info: 計算には使わないが、配る人に大事なメモ（裏口・鍵・置き場所）。短く
決まり:
- 先は一覧の id をそのまま使う。一覧に無い先は作らない
- 書いていないこと・言っていないことを、勝手に決めない
- why には、メモの言葉か人の話を短く
- 返事はやさしい日本語で短く`;

export interface NoteInput {
  id: string;
  name: string;
  window?: string;
  howTo?: string;
  caution?: string;
  note?: string;
}

const NotesOut = z.object({ rules: z.array(AiRuleSchema) });

/** 配送メモを読んで条件にする（メモのある先だけ渡す。多いときは分けて呼ぶ） */
export async function readNotes(notes: NoteInput[]): Promise<AiRule[]> {
  if (!hasRouteAi()) throw new Error("AI のキーがありません（設定 → AI）");
  const client = aiClient(FEATURE, { timeout: 180_000 });
  const out: AiRule[] = [];
  for (let i = 0; i < notes.length; i += 80) {
    const part = notes.slice(i, i + 80);
    const res = await client.beta.messages.parse({
      model: ROUTE_AI_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: betaZodOutputFormat(NotesOut) },
      system: `${BASE}\n\n仕事: 各先の配送メモを読み、計算に効く条件（window・service・closed）と、配る人に大事なメモ（info）を出す。いまの時間の希望（window）と同じなら出さない。条件にならない先は何も出さない。`,
      messages: [{ role: "user", content: `## 先とメモ\n${JSON.stringify(part)}` }],
    });
    if (res.stop_reason === "refusal") throw new Error("AI が答えられませんでした");
    if (!res.parsed_output) throw new Error("AI の答えを読めませんでした。もう一度押してください");
    out.push(...res.parsed_output.rules);
  }
  return out;
}

export const RouteOptionsPatch = z.object({
  courses: z.number().nullable().describe("コースの数。変えないなら null。自動にするなら 0"),
  earliestDepart: z.string().nullable().describe("いちばん早い出発 HH:MM。変えないなら null"),
  maxHours: z.number().nullable().describe("1コースの上限（時間）。変えないなら null"),
  breakMinutes: z.number().nullable().describe("休けい（分）。変えないなら null"),
});
export type RouteOptionsPatchT = z.infer<typeof RouteOptionsPatch>;

const ChatOut = z.object({
  reply: z.string().describe("人への返事。やさしい日本語で1〜3文。何を変えたか・確かめたいこと"),
  rules: z.array(AiRuleSchema).describe("条件の全部（変えないものもそのまま返す。消すものは入れない）"),
  options: RouteOptionsPatch,
});

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface ChatContext {
  weekday: number;
  options: { courses: string; earliestDepart: string; maxHours: string; breakMinutes: string };
  rules: AiRule[];
  stops: { id: string; name: string; window?: string; course?: string }[];
  /** さっきの結果の短いまとめ（あれば） */
  lastResult?: string;
}

/** 人の話を、条件と計算の決まりに直す */
export async function chatRoutes(turns: ChatTurn[], ctx: ChatContext) {
  if (!hasRouteAi()) throw new Error("AI のキーがありません（設定 → AI）");
  const client = aiClient(FEATURE, { timeout: 120_000 });
  const head = `## 曜日\n${WD[ctx.weekday]}曜\n## 計算の決まり（空=自動）\n${JSON.stringify(ctx.options)}\n## いまの条件\n${JSON.stringify(ctx.rules)}\n## 先の一覧（id・名前・時間の希望・今の便）\n${JSON.stringify(ctx.stops)}${ctx.lastResult ? `\n## さっきの結果\n${ctx.lastResult}` : ""}`;
  const messages = turns.map((t, i) => ({
    role: t.role,
    content: i === turns.length - 1 && t.role === "user" ? `${head}\n\n## 人の話\n${t.text}` : t.text,
  }));
  const res = await client.beta.messages.parse({
    model: ROUTE_AI_MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: betaZodOutputFormat(ChatOut) },
    system: `${BASE}\n\n仕事: 人の話を聞いて、条件の全部と、計算の決まりの変更を返す。言われた所だけ直し、ほかの条件はそのまま返す。人の名前が出ても、先の名前と取りちがえない（人のコースは backBy の label）。`,
    messages,
  });
  if (res.stop_reason === "refusal") throw new Error("AI が答えられませんでした。言い方を変えてもう一度");
  const out = res.parsed_output;
  if (!out) throw new Error("AI の答えを読めませんでした。もう一度送ってください");
  return out;
}

/** 計算の結果を説明する（文だけ） */
export async function explainResult(resultText: string): Promise<string> {
  if (!hasRouteAi()) throw new Error("AI のキーがありません（設定 → AI）");
  const client = aiClient(FEATURE, { timeout: 120_000 });
  const res = await client.messages.create({
    model: ROUTE_AI_MODEL,
    max_tokens: 3000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    system: `${BASE}\n\n仕事: コースの見直し案を、今のコースと比べて説明する。はじめに大事なこと（コースの数・遅れる先・いちばん早い出発・帰る時刻）を1〜2文。そのあと、何が変わったか・なぜそうなったか（条件のせい・遠い先・時間の希望）を短い箇条書きで3〜6行。入らなかった先や守れなかった決まりがあれば、どうすればよいかも。数字は結果のとおりに。むずかしいことばは使わない。マークダウンの見出しは使わない。`,
    messages: [{ role: "user", content: resultText }],
  });
  if (res.stop_reason === "refusal") throw new Error("AI が答えられませんでした");
  return res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
}
