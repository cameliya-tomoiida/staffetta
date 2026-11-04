import "server-only";
// 辞書に無い言葉（商品名・生地名など）を Claude API で訳し、machine.json に保存して次から使い回す。
// 訳した言葉は画面で「機械翻訳」と表示する。訳せなかったときは日本語のまま出す（画面は止めない）。
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { langInfo, type Lang } from "./langs";

export const TRANSLATE_MODEL = "claude-sonnet-5-5";
const FILE = path.join(process.cwd(), "src", "i18n", "machine.json");

type Cache = Partial<Record<Lang, Record<string, string>>>;

let queue: Promise<unknown> = Promise.resolve();
async function readCache(): Promise<Cache> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as Cache;
  } catch {
    return {};
  }
}

const Schema = z.object({
  items: z.array(z.object({ ja: z.string().describe("元の日本語"), text: z.string().describe("訳") })),
});

async function askClaude(lang: Lang, terms: string[]): Promise<Record<string, string>> {
  const info = langInfo(lang);
  const target =
    lang === "ja-easy"
      ? "やさしい日本語（漢字を使わず、ひらがな・カタカナで。外国人の新人スタッフが読める短いことば）"
      : `${info.ja}（${info.native}）`;
  const client = new Anthropic();
  const res = await client.beta.messages.parse({
    model: TRANSLATE_MODEL,
    max_tokens: 4000,
    output_config: { format: betaZodOutputFormat(Schema) },
    system:
      "あなたはパン・ピザ工場の現場向けの翻訳係です。製造ラインの外国人スタッフが工程表で読む、商品名・生地名・材料名を訳します。" +
      "短く、現場で通じる言葉にしてください。カタカナの商品名は、その国でふつうに使う呼び名に。サイズ（23cm）や「8枚切」などの数字は残します。",
    messages: [
      {
        role: "user",
        content: `次の日本語を ${target} に訳してください。1つずつ、元の日本語と訳を組にして返してください。\n\n${terms.map((t) => `- ${t}`).join("\n")}`,
      },
    ],
  });
  const out: Record<string, string> = {};
  for (const it of res.parsed_output?.items ?? []) if (terms.includes(it.ja) && it.text.trim()) out[it.ja] = it.text.trim();
  return out;
}

/**
 * 日本語の言葉をまとめて訳す。返り値は { 日本語: 訳 }。
 * 保存済みの訳はそのまま使い、無いものだけ Claude に聞く。
 */
export async function translateTerms(lang: Lang, terms: string[]): Promise<Record<string, string>> {
  if (lang === "ja") return {};
  const uniq = [...new Set(terms.filter(Boolean))];
  const cache = await readCache();
  const have = cache[lang] ?? {};
  const missing = uniq.filter((t) => !have[t]);
  if (missing.length && process.env.ANTHROPIC_API_KEY) {
    try {
      const got = await askClaude(lang, missing);
      if (Object.keys(got).length) {
        // 書き込みは1つずつ（同時に開いても訳が消えないように）
        const run = queue.then(async () => {
          const latest = await readCache();
          latest[lang] = { ...(latest[lang] ?? {}), ...got };
          await fs.writeFile(FILE, JSON.stringify(sortCache(latest), null, 2) + "\n", "utf8");
        });
        queue = run.catch(() => undefined);
        await run;
        Object.assign(have, got);
      }
    } catch (e) {
      console.error("[translate]", lang, e instanceof Error ? e.message : e);
    }
  }
  return Object.fromEntries(uniq.filter((t) => have[t]).map((t) => [t, have[t]]));
}

const sortCache = (c: Cache) =>
  Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Object.fromEntries(Object.entries(v ?? {}).sort(([a], [b]) => a.localeCompare(b, "ja")))]));
