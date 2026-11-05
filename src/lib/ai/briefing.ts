// 朝の「今日の要点」（AI の案 G・作者 11/6 (34)）: 管理者のホームに3行。
// その日に初めて管理者のホームを開いたときに1回作って覚えておく（「作り直す」で作り直せる）。
// AI（Haiku 5.5）が数字から3行の文を書く。キーが無い・上限・通信のときは、数字から決まりの3行を作る。
import "server-only";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { kvGet, kvSet } from "@/lib/db/sqlite";
import { isOn } from "@/lib/settings/features";
import { aiClient } from "./client";
import { apiKey } from "./settings";

export const BRIEF_MODEL = "claude-haiku-5-5";

export interface BriefFacts {
  date: string;
  orders: number;
  sales: number;
  grossRate: number;
  review: number;
  fax: number;
  purchaseDraft: number;
  overdue: number;
  lowStock: number;
  urgent: number;
  lines: { name: string; pieces: number; unit: string; room?: number }[];
  alerts: string[];
}
export interface Briefing { date: string; lines: string[]; by: "AI" | "数字"; at: string }

const key = (date: string) => `ai_brief_${date}`;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** 数字だけで作る3行（AI が使えないとき） */
export function ruleBriefing(f: BriefFacts): string[] {
  const out: string[] = [];
  out.push(`${md(f.date)} 納品は ${f.orders} 件・売上 ${Math.round(f.sales).toLocaleString("ja-JP")}円（粗利 ${Math.round(f.grossRate * 1000) / 10}%）。`);
  const todo = [f.review && `要確認の注文 ${f.review} 件`, f.fax && `FAX ${f.fax} 枚`, f.purchaseDraft && `発注書の承認 ${f.purchaseDraft} 枚`].filter(Boolean);
  out.push(todo.length ? `まず ${todo.join("・")} を片づけましょう。` : "確認待ちの注文・発注書はありません。");
  const over = f.lines.find((l) => l.room != null && l.room < 0);
  const worry = [f.overdue && `締めを過ぎた発注書 ${f.overdue} 枚`, f.lowStock && `足りなくなる材料 ${f.lowStock} 件`, over && `${over.name}が上限を ${-over.room!} ${over.unit} 超え`, f.urgent && `急ぎのお知らせ ${f.urgent} 件`].filter(Boolean);
  out.push(worry.length ? `気になること: ${worry.join("・")}。` : "気になることはありません。");
  return out;
}

const BriefSchema = z.object({ lines: z.array(z.string()).describe("3行。1行40字くらい。1行目=今日の注文と売上、2行目=まずやること、3行目=気になること") });

async function aiBriefing(f: BriefFacts): Promise<string[] | null> {
  if (!apiKey()) return null;
  try {
    const res = await aiClient("朝の今日の要点").beta.messages.parse({
      model: BRIEF_MODEL,
      max_tokens: 1000,
      output_config: { format: betaZodOutputFormat(BriefSchema) },
      system: "パン工場の専務に、朝いちばんに今日の要点を3行で伝える係です。数字は渡されたものだけを使い、作らない。やさしい日本語で、短く、具体的に。アプリの画面の言葉（要確認の注文・FAX・発注書の承認・締め・材料の不足）を使う。英語やカタカナの言いかえ（レビュー・購買）は使わない。",
      messages: [{ role: "user", content: JSON.stringify({
        納品日: f.date, 注文の数: f.orders, 売上の円: Math.round(f.sales), 粗利率: `${Math.round(f.grossRate * 1000) / 10}%`,
        要確認の注文: f.review, 確認待ちのFAX: f.fax, 承認待ちの発注書: f.purchaseDraft, 締めを過ぎた発注書: f.overdue, 足りなくなる材料: f.lowStock, 急ぎのお知らせ: f.urgent,
        ライン: f.lines.map((l) => ({ 名前: l.name, 作る数: `${l.pieces}${l.unit}`, ...(l.room != null ? { 上限までの余裕: `${l.room}${l.unit}` } : {}) })),
        お知らせ: f.alerts,
      }) }],
    });
    const lines = res.parsed_output?.lines.map((l) => l.trim()).filter(Boolean).slice(0, 3);
    return lines && lines.length ? lines : null;
  } catch {
    return null;
  }
}

/** その日の要点（無ければ作る。force で作り直す） */
export async function briefingFor(f: BriefFacts, today: string, force = false): Promise<Briefing | null> {
  if (!isOn("ai_briefing")) return null;
  const cur = kvGet<Briefing>(key(today));
  if (cur && !force) return cur;
  const ai = await aiBriefing(f);
  const b: Briefing = { date: today, lines: ai ?? ruleBriefing(f), by: ai ? "AI" : "数字", at: new Date().toISOString() };
  kvSet(key(today), b);
  return b;
}
