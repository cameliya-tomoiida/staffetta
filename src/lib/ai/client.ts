// Claude の API の共通の口（作者 11/6 (25)）。FAX・LINE・メールの読み取り、納品書、翻訳、相談チャット、衛生管理の AI がここから呼ぶ。
// - キーは「設定 → AI」で入れたもの（無ければ .env.local）
// - 呼ぶ前に月の上限を見て、超えていれば止める。呼んだあとに使った量（トークン・金額のめやす）を記録する
// - 包むのは beta.messages.parse と messages.create（ストリーミングでない呼び方）。ほかの呼び方を足したら、ここも包む
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { apiKey, assertBudget, recordUsage } from "./settings";

type ClientOptions = ConstructorParameters<typeof Anthropic>[0];
type WithUsage = { model?: string; usage?: Parameters<typeof recordUsage>[2] };

function track<F extends (...a: never[]) => unknown>(feature: string, fn: F): F {
  return (async (...args: Parameters<F>) => {
    assertBudget();
    const res = (await fn(...args)) as WithUsage;
    try {
      // ストリーミング（stream: true）のときは usage が無いので記録しない
      if (res && typeof res === "object" && res.usage && res.model) recordUsage(feature, res.model, res.usage);
    } catch {
      /* 記録に失敗しても、結果は返す */
    }
    return res;
  }) as unknown as F;
}

export function aiClient(feature: string, opts: ClientOptions = {}): Anthropic {
  const key = apiKey();
  const client = new Anthropic({ ...opts, ...(key ? { apiKey: key } : {}) });
  client.beta.messages.parse = track(feature, client.beta.messages.parse.bind(client.beta.messages)) as typeof client.beta.messages.parse;
  client.messages.create = track(feature, client.messages.create.bind(client.messages)) as typeof client.messages.create;
  return client;
}
