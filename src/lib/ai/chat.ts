// AI 相談チャット（作者 11/6 (25)）。全画面の右下「AI に聞く」から。
// アプリの使い方・困りごとに答え、設定を変える必要があれば、その画面へのボタンを出す（答えの中の links）。
// 渡すもの: アプリの説明（画面ごと・README の要点）・聞いた人の役割・今いる画面とその中身（画面から送る文字）・管理者には機能の ON/OFF。
// 役割で見せてよい中身を分ける（開けない画面のボタンは出さない・管理者以外には設定の中身を渡さない）。会話は人ごとに残す（直近 40 件）。
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { aiClient } from "./client";
import { apiKey } from "./settings";
import { knownHref, SCREENS } from "./guide";
import { canOpen, type Role } from "@/lib/auth/roles";
import { kvGet, kvSet } from "@/lib/db/sqlite";
import { listFlags } from "@/lib/settings/features";

export const CHAT_MODEL = "claude-sonnet-5-5";

export interface ChatMessage { role: "user" | "assistant"; text: string; links?: { label: string; href: string }[]; at: string; path?: string }

const AnswerSchema = z.object({
  answer: z.string().describe("やさしい日本語で、短く（3〜6文）。手順は番号つき。分からないことは分からないと言う"),
  links: z.array(z.object({ label: z.string().describe("ボタンの文字（例: 「AI の設定を開く」）"), href: z.string().describe("画面の一覧にある行き先だけ（/ で始まる）") })).describe("設定を変える・見に行く画面があればボタンに。無ければ空"),
});

const logKey = (userKey: string) => `ai_chat_${userKey}`;
export const chatLog = (userKey: string): ChatMessage[] => kvGet<ChatMessage[]>(logKey(userKey)) ?? [];
const saveLog = (userKey: string, list: ChatMessage[]) => kvSet(logKey(userKey), list.slice(-40));
export const clearChat = (userKey: string) => kvSet(logKey(userKey), []);

let readme: string | null = null;
async function readmeDigest() {
  if (readme == null) {
    readme = await fs.readFile(path.join(process.cwd(), "README.md"), "utf8").catch(() => "");
    readme = readme.replace(/<[^>]+>/g, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").slice(0, 6000);
  }
  return readme;
}

function system(role: Role, name: string, flags: string) {
  const screens = SCREENS.filter((s) => canOpen(role, s.href)).map((s) => `- ${s.name}（${s.href}）: ${s.what}`).join("\n");
  return `あなたは、パン・ピザ工場の受発注アプリ「STAFFETTA」の使い方の相談係です。
聞いている人: ${name || "（名前なし）"}・役割は「${role}」。年配の人や外国の人もいるので、やさしい日本語で、短く答えてください。

決まり:
- アプリの使い方・困りごとに答える。分からない・アプリに無い機能は、正直に「ありません」「分かりません」と言う。作り話をしない。
- 設定を変える必要があるとき、見に行く画面があるときは、links にその画面を入れる（下の「この人が開ける画面」にあるものだけ）。
- お金が動く・取引先に送る・データを消すことは、人がボタンを押す決まり。AI が代わりにやるとは言わない。
- パスワード・API キーなどの秘密は聞かない・答えない。

この人が開ける画面:
${screens}
${flags ? `\n今の機能の ON/OFF（管理者にだけ渡す）:\n${flags}\n` : ""}`;
}

export async function askAi(input: { userKey: string; role: Role; name: string; question: string; path: string; pageText: string }): Promise<ChatMessage> {
  const question = input.question.trim().slice(0, 1000);
  if (!question) throw new Error("聞きたいことを入れてください");
  if (!apiKey()) throw new Error("AI の設定がまだです。管理者が「設定 → AI」で API キーを入れてください");
  const history = chatLog(input.userKey).slice(-10);
  const flags = input.role === "管理者" ? listFlags().map((f) => `- ${f.label}: ${f.on ? "使う／自動" : "使わない／人に聞く"}`).join("\n") : "";
  const page = SCREENS.find((s) => s.href !== "/" && input.path.startsWith(s.href))?.name ?? (input.path === "/" ? "FAX受信箱" : input.path);
  const client = aiClient("AI 相談チャット");
  const res = await client.beta.messages.parse({
    model: CHAT_MODEL,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: betaZodOutputFormat(AnswerSchema) },
    system: [
      { type: "text", text: system(input.role, input.name, flags) },
      { type: "text", text: `## アプリの説明書（README の要点）\n${await readmeDigest()}`, cache_control: { type: "ephemeral" } },
    ],
    messages: [
      ...history.map((m) => ({ role: m.role, content: m.text })),
      { role: "user" as const, content: `【いま見ている画面】${page}（${input.path}）\n【画面の中身（一部）】\n${input.pageText.slice(0, 3000)}\n\n【質問】${question}` },
    ],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error("うまく答えられませんでした。聞き方を変えてもう一度どうぞ");
  const links = res.parsed_output.links
    .filter((l) => l.href.startsWith("/") && !l.href.startsWith("//") && knownHref(l.href) && canOpen(input.role, l.href.split("?")[0]))
    .slice(0, 3);
  const now = new Date().toISOString();
  const answer: ChatMessage = { role: "assistant", text: res.parsed_output.answer, links, at: now };
  saveLog(input.userKey, [...chatLog(input.userKey), { role: "user", text: question, at: now, path: input.path }, answer]);
  return answer;
}
