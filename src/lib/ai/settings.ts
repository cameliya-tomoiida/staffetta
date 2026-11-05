// AI（Claude の API）の設定と、使った量（作者 11/6 (25)）。
// - API キー: 設定画面で担当者が入れる（Claude は入れない）。画面には伏せ字で出す。入れていなければ .env.local の ANTHROPIC_API_KEY を使う
// - 使った量: 月ごと・機能ごとに、呼んだ回数・入力／出力のトークン・金額のめやす（ドル → 円）を kv に足していく
// - 月の上限（円）: 超えたら AI を呼ばずに止める（FAX の読み取りなども止まるので、画面で知らせる）
// 値段（100万トークンあたりのドル）は Anthropic の公表値（2026-11 時点）。モデルが変わったらここを直す。
import "server-only";
import { kvGet, kvSet } from "@/lib/db/sqlite";

export interface AiSettings {
  /** 画面で入れた API キー（無ければ .env.local のキー） */
  apiKey?: string;
  /** 月の上限（円）。空なら上限なし */
  monthlyLimitYen?: number;
  /** 1ドル何円で計算するか */
  yenPerDollar: number;
}

const KEY = "ai_settings";
const DEFAULT: AiSettings = { yenPerDollar: 150 };

/** 100万トークンあたりのドル（入力・出力） */
export const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};
const priceOf = (model: string) => PRICES[model] ?? PRICES[Object.keys(PRICES).find((k) => model.startsWith(k)) ?? ""] ?? PRICES["claude-opus-5-5"];

export const getAiSettings = (): AiSettings => ({ ...DEFAULT, ...(kvGet<Partial<AiSettings>>(KEY) ?? {}) });

/** 使う API キー（画面で入れたもの → .env.local） */
export const apiKey = () => getAiSettings().apiKey || process.env.ANTHROPIC_API_KEY || "";

/** 画面に出す形（キーは伏せ字） */
export function publicAiSettings() {
  const s = getAiSettings();
  const k = apiKey();
  return {
    keySource: s.apiKey ? ("settings" as const) : process.env.ANTHROPIC_API_KEY ? ("env" as const) : ("none" as const),
    keyMasked: k ? `${k.slice(0, 7)}…${k.slice(-4)}` : "",
    monthlyLimitYen: s.monthlyLimitYen ?? null,
    yenPerDollar: s.yenPerDollar,
  };
}

export function setAiSettings(input: { apiKey?: string | null; monthlyLimitYen?: number | null; yenPerDollar?: number }, who: string) {
  if (!who.trim()) throw new Error("変える人を選んでください");
  const cur = getAiSettings();
  const next: AiSettings = { ...cur };
  if (input.apiKey !== undefined) {
    const k = (input.apiKey ?? "").trim();
    if (k && !/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k)) throw new Error("API キーの形が違います（sk-ant- で始まる文字）");
    if (k) next.apiKey = k;
    else delete next.apiKey; // 空にしたら .env.local のキーに戻す
  }
  if (input.monthlyLimitYen !== undefined) {
    if (input.monthlyLimitYen == null) delete next.monthlyLimitYen;
    else if (!(input.monthlyLimitYen >= 0)) throw new Error("月の上限は 0 以上の数にしてください");
    else next.monthlyLimitYen = Math.round(input.monthlyLimitYen);
  }
  if (input.yenPerDollar !== undefined) {
    if (!(input.yenPerDollar > 0)) throw new Error("1ドルの円は 0 より大きい数にしてください");
    next.yenPerDollar = input.yenPerDollar;
  }
  kvSet(KEY, next);
  kvSet(`${KEY}_log`, [...(kvGet<{ at: string; who: string; what: string }[]>(`${KEY}_log`) ?? []).slice(-49), {
    at: new Date().toISOString(), who,
    what: [input.apiKey !== undefined ? (next.apiKey ? "API キーを入れた" : "API キーを消した（.env に戻す）") : "", input.monthlyLimitYen !== undefined ? `月の上限 ${next.monthlyLimitYen ?? "なし"}` : "", input.yenPerDollar !== undefined ? `1ドル ${next.yenPerDollar}円` : ""].filter(Boolean).join("・"),
  }]);
}

// ───────── 使った量 ─────────
export interface UsageBucket { calls: number; input: number; output: number; usd: number }
export interface MonthUsage extends UsageBucket { byFeature: Record<string, UsageBucket> }

const monthKey = (iso: string) => `ai_usage_${iso.slice(0, 7)}`;
const jstMonth = (ms = Date.now()) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 7);
const empty = (): UsageBucket => ({ calls: 0, input: 0, output: 0, usd: 0 });

export function costUsd(model: string, input: number, output: number) {
  const p = priceOf(model);
  return (input * p.input + output * p.output) / 1_000_000;
}

/** 1回呼んだ分を足す（入力のトークンは、キャッシュから読んだ分・書いた分も入力として数える＝多めのめやす） */
export function recordUsage(feature: string, model: string, usage: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | undefined, nowMs = Date.now()) {
  const input = (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0);
  const output = usage?.output_tokens ?? 0;
  const usd = costUsd(model, input, output);
  const key = monthKey(jstMonth(nowMs));
  const m: MonthUsage = kvGet<MonthUsage>(key) ?? { ...empty(), byFeature: {} };
  const add = (b: UsageBucket) => ({ calls: b.calls + 1, input: b.input + input, output: b.output + output, usd: b.usd + usd });
  kvSet(key, { ...add(m), byFeature: { ...m.byFeature, [feature]: add(m.byFeature[feature] ?? empty()) } });
}

export function monthUsage(month = jstMonth()): MonthUsage {
  return kvGet<MonthUsage>(monthKey(month)) ?? { ...empty(), byFeature: {} };
}
export const recentMonths = (n = 3, ms = Date.now()) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(ms + 9 * 3600_000);
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - i);
    return d.toISOString().slice(0, 7);
  });

/** 月の上限を超えていたら止める */
export function assertBudget(nowMs = Date.now()) {
  const s = getAiSettings();
  if (s.monthlyLimitYen == null) return;
  const yen = monthUsage(jstMonth(nowMs)).usd * s.yenPerDollar;
  if (yen >= s.monthlyLimitYen) throw new Error(`今月の AI の上限（${s.monthlyLimitYen.toLocaleString("ja-JP")}円）に達したので止めています。「設定 → AI」で上限を見直してください`);
}
