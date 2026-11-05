import "server-only";
// 製品カードの形を AI と話して直す（⑦の(30)）。Claude を呼ぶのは①の aiClient（月の上限・使った量の記録）。
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { aiClient } from "@/lib/ai/client";
import { apiKey } from "@/lib/ai/settings";
import { AiTemplateSchema, normalizeTemplate, templateText } from "./ai-template";
import type { CardTemplate } from "./template";

export const TEMPLATE_AI_MODEL = "claude-opus-5-5";
export const hasTemplateAi = () => !!apiKey();

const SYSTEM = `あなたは食品工場（パン・ピザ）の製造の記録の担当です。工場の人と話しながら「製品カード」（生地ごと・日ごとに1枚、製品が通る工程を だれが・何時に したかを書く紙）の形を直します。
形 = 工程の行の並び。行ごとに書く欄（time=はじめ・おわりの時刻 / staff=担当者 / temp=温度（目標・下限・上限）/ qty=数 / check=○×）と、ロスを製品ごとに書くか（lossLabel）を決めます。
決まり:
- 言われた所だけ直し、ほかの工程・欄・並びは変えない。いまの形を全部返す。
- 工程の順は、実際の作り方の順（計量 → ミキサー → 分割 → 成形 → トッピング → 焼成 → 冷却 → 急速冷凍 → 包装 → 金属検査 → 保管 など）。「〜のあとに」と言われたら、その直後に入れる。
- 言っていない温度の数字は勝手に決めない（null）。ふつうの目安があるときは返事で確かめる。
- 金属検査は CCP。
- 返事はやさしい日本語で短く。`;

export interface TemplateTurn {
  role: "user" | "assistant";
  text: string;
}

export async function chatTemplate(turns: TemplateTurn[], current: CardTemplate) {
  if (!hasTemplateAi()) throw new Error("AI のキーがありません（設定 → AI）");
  const client = aiClient("製品カードの形の AI", { timeout: 120_000 });
  const messages = turns.map((t, i) => ({
    role: t.role,
    content: i === turns.length - 1 && t.role === "user" ? `## いまの形\n${templateText(current)}\n\n## 人の話\n${t.text}` : t.text,
  }));
  const res = await client.beta.messages.parse({
    model: TEMPLATE_AI_MODEL,
    max_tokens: 6000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: betaZodOutputFormat(AiTemplateSchema) },
    system: SYSTEM,
    messages,
  });
  if (res.stop_reason === "refusal") throw new Error("AI が答えられませんでした。言い方を変えてもう一度");
  const out = res.parsed_output;
  if (!out) throw new Error("AI の答えを読めませんでした。もう一度送ってください");
  const { template, warnings } = normalizeTemplate(out.template, current);
  return { reply: out.reply, template, warnings };
}
