// Claude の API の共通の口（作者 11/6 (25)）。FAX・LINE・メールの読み取り、納品書、翻訳、相談チャットがここから呼ぶ。
// - キーは「設定 → AI」で入れたもの（無ければ .env.local）
// - 呼ぶ前に月の上限を見て、超えていれば止める。呼んだあとに使った量（トークン・金額のめやす）を記録する
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { apiKey, assertBudget, recordUsage } from "./settings";

type ClientOptions = ConstructorParameters<typeof Anthropic>[0];

export function aiClient(feature: string, opts: ClientOptions = {}): Anthropic {
  const key = apiKey();
  const client = new Anthropic({ ...opts, ...(key ? { apiKey: key } : {}) });
  const messages = client.beta.messages;
  const parse = messages.parse.bind(messages);
  // beta.messages.parse を包んで、上限の確認と使った量の記録を足す
  messages.parse = (async (...args: Parameters<typeof parse>) => {
    assertBudget();
    const res = await parse(...args);
    try {
      recordUsage(feature, res.model, res.usage);
    } catch {
      /* 記録に失敗しても、読み取りの結果は返す */
    }
    return res;
  }) as typeof messages.parse;
  return client;
}
