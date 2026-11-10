// LINE の読み取り（Claude）が一時的に失敗したときの、やり直しと同時呼び出しの制限（④）。
// 例: お客さん2人がほぼ同時に送り、その数秒だけ通信が切れて「Connection error.」になった。
// SDK も 0.5〜8秒の間で2回やり直すが、数十秒の途切れには短すぎる。ここで間をあけて、さらにやり直す。
// それでもだめなら呼び出し元が「読み取りに失敗（要確認）」として原文つきで残す（注文は消えない）。
import Anthropic from "@anthropic-ai/sdk";

/** やり直す前に待つ時間（ミリ秒）。長さ＝やり直しの回数の上限（最初の1回のほかに3回） */
export const READ_RETRY_DELAYS_MS = [5_000, 20_000, 45_000];
/** 同時に Claude へ読み取りを頼む数の上限（1つのハブの中で） */
export const READ_MAX_CONCURRENT = 2;

/** やり直せば通りそうな失敗か（通信の途切れ・時間切れ・混雑・サーバー側のエラー） */
export function isRetriableReadError(e: unknown): boolean {
  if (e instanceof Anthropic.APIConnectionError) return true; // APIConnectionTimeoutError もこの仲間
  if (e instanceof Anthropic.APIError) {
    const s = e.status ?? 0;
    return s === 408 || s === 409 || s === 429 || s >= 500;
  }
  return false;
}

/** 画面に残す失敗の説明。「Connection error.」だけでは分からないので、下の原因（ECONNRESET など）も添える */
export function describeReadError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const codes: string[] = [];
  let c = (e as { cause?: unknown } | null)?.cause;
  for (let i = 0; c && i < 3; i++) {
    const code = (c as { code?: unknown }).code;
    if (typeof code === "string" && !codes.includes(code)) codes.push(code);
    c = (c as { cause?: unknown }).cause;
  }
  return codes.length ? `${msg}（${codes.join(" / ")}）` : msg;
}

type RetryOpts = {
  delays?: number[];
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, e: unknown) => void;
};

/** fn を実行し、やり直せる失敗なら間をあけてやり直す。最後の失敗はそのまま投げる（attempts を付ける） */
export async function withReadRetry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<{ value: T; attempts: number }> {
  const delays = opts.delays ?? READ_RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return { value: await fn(), attempts: attempt };
    } catch (e) {
      if (attempt > delays.length || !isRetriableReadError(e)) {
        throw Object.assign(e instanceof Error ? e : new Error(String(e)), { attempts: attempt });
      }
      opts.onRetry?.(attempt, e);
      await sleep(delays[attempt - 1]);
    }
  }
}

// 同時に頼む数を絞る（3人目からは、前の読み取りが終わるのを待つ）
let running = 0;
const waiting: (() => void)[] = [];
export async function limitConcurrentReads<T>(fn: () => Promise<T>, max = READ_MAX_CONCURRENT): Promise<T> {
  // 空きがなければ並ぶ。終わった人が、自分の枠をそのまま次の人にわたす
  if (running >= max) await new Promise<void>((r) => waiting.push(r));
  else running++;
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}
