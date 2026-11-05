import "server-only";
// 衛生チェックシートを AI とのチャットで作る（⑦の(24)）。Claude を呼ぶところ。
// キーは①の「設定 → AI」（無ければ環境変数 ANTHROPIC_API_KEY）。呼ぶのは①の aiClient（月の上限・使った量の記録）。キーが無ければ画面にボタンを出さない。
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { aiClient } from "@/lib/ai/client";
import { apiKey } from "@/lib/ai/settings";
import { AiSheetSchema, draftText, normalizeDraft } from "./ai-sheet";
import type { SheetDef } from "./sheets";

export const SHEET_AI_MODEL = "claude-opus-5-5";
export const hasAiKey = () => !!apiKey();

const SYSTEM = `あなたは食品工場（パン・ピザ・米飯）の衛生管理の担当です。工場の人と話しながら、毎月印刷して現場で書く「衛生管理のチェックシート」を作ります。
決まり:
- 返事はやさしい日本語。専門用語は使うときに一言説明する。
- 人の言ったことを、シートの形（温度の記録・点検清掃・毎日のチェック・記録の表・ラベル）に当てはめる。言っていない数字（温度の基準など）は勝手に決めず、ふつうの目安を「目安」として入れて、返事で確かめる。
- 製品が通る道のチェック（焼成温度・急速冷凍・金属検査・包装・ミキサー・製造日報）は「製品カード」にあるので、ここでは作らない。頼まれたら、製品カードにあると伝える。
- HACCP の考え方で、足りないと思うチェック（記録する人・外れたときの措置・確認の回数・責任者の確認など）を suggestions で短く提案する。押しつけない。
- いまの下書きがあれば、それを直して全部を返す（言われていない所は変えない）。
- 温度の記録は、目盛りに●を打つ形（scale）にすると現場で書きやすい。範囲の外の目盛りも上下に2つずつ入れる。`;

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

/** 会話といまの下書きから、次の下書きと返事を作る */
export async function chatSheet(turns: ChatTurn[], current: SheetDef | undefined, id: string) {
  if (!hasAiKey()) throw new Error("AI のキーがありません（設定 → AI）");
  const client = aiClient("衛生シートの AI", { timeout: 120_000 });
  const messages = turns.map((t, i) => ({
    role: t.role,
    content: i === turns.length - 1 && t.role === "user" ? `## いまの下書き\n${draftText(current)}\n\n## 人の話\n${t.text}` : t.text,
  }));
  const res = await client.beta.messages.parse({
    model: SHEET_AI_MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: betaZodOutputFormat(AiSheetSchema) },
    system: SYSTEM,
    messages,
  });
  if (res.stop_reason === "refusal") throw new Error("AI が答えられませんでした。言い方を変えてもう一度");
  const out = res.parsed_output;
  if (!out) throw new Error("AI の答えを読めませんでした。もう一度送ってください");
  const { def, warnings } = normalizeDraft(out.sheet, id);
  return { reply: out.reply, suggestions: out.suggestions.slice(0, 3), def, warnings, model: res.model };
}
