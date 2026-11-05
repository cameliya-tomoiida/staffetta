import "server-only";
// 辞書に無い言葉（商品名・生地名・工程名・設備名など）を Claude API で訳して、使い回す。
//
// 訳の置き場所は2つ:
//   src/i18n/machine.json  … 初期データの全語の訳（scripts/pretranslate.ts で作ってコミットする。画面からは書かない）
//   data/i18n-machine.json … あとからマスタに足した語の訳（画面・保存のたびに裏で足す。src の外なので開発サーバーが読み直さない）
//
// 画面は待たない: 訳がまだ無い語は日本語のまま出し、裏で訳を作る（できたら画面が取り直して差し替える）。
// マスタを保存したときは warmMasterTranslations() で10言語ぶんを裏でまとめて作っておく。
// 訳した言葉は画面で「機械翻訳」と表示する。訳せなかったときは日本語のまま（画面は止めない）。
import { aiClient } from "@/lib/ai/client";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { LANGS, langInfo, type Lang } from "./langs";
import { tr } from "./dict";
import type { Masters } from "@/data/types";

export const TRANSLATE_MODEL = "claude-sonnet-5-5";
const SEED_FILE = path.join(process.cwd(), "src", "i18n", "machine.json");
const RUNTIME_FILE = path.join(process.cwd(), "data", "i18n-machine.json");

type Cache = Partial<Record<Lang, Record<string, string>>>;

async function readFile(file: string): Promise<Cache> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as Cache;
  } catch {
    return {};
  }
}
/** 2つの置き場所をまとめて読む（あとから足した訳が優先） */
async function readCache(): Promise<Cache> {
  const [seed, runtime] = await Promise.all([readFile(SEED_FILE), readFile(RUNTIME_FILE)]);
  const out: Cache = {};
  for (const l of new Set([...Object.keys(seed), ...Object.keys(runtime)]) as Set<Lang>) out[l] = { ...(seed[l] ?? {}), ...(runtime[l] ?? {}) };
  return out;
}

const Schema = z.object({
  items: z.array(z.object({ ja: z.string().describe("元の日本語"), text: z.string().describe("訳") })),
});

/** 画面の辞書（dict.ts）の言葉を用語集として渡し、訳をそろえる（例: 生地を「麺」と訳さない） */
const glossary = (lang: Lang) =>
  (["dough", "flour", "pieces", "mix", "proof", "bake"] as const).map((k) => `- ${tr("ja", k)} → ${tr(lang, k)}`).join("\n");

async function askClaude(lang: Lang, terms: string[]): Promise<Record<string, string>> {
  const info = langInfo(lang);
  const target =
    lang === "ja-easy"
      ? "やさしい日本語（漢字を使わず、ひらがな・カタカナで。外国人の新人スタッフが読める短いことば）"
      : `${info.ja}（${info.native}）`;
  const client = aiClient("翻訳");
  const res = await client.beta.messages.parse({
    model: TRANSLATE_MODEL,
    max_tokens: 8000,
    output_config: { format: betaZodOutputFormat(Schema) },
    system:
      "あなたはパン・ピザ工場の現場向けの翻訳係です。製造ラインの外国人スタッフが工程表で読む、商品名・生地名・材料名・工程名・設備名を訳します。" +
      "短く、現場で通じる言葉にしてください。カタカナの商品名は、その国でふつうに使う呼び名に。\n" +
      "守ること:\n" +
      "- 数字は 0〜9 のアラビア数字のまま書く。その国の数字（例: ၂၃ や २३）に変えない。\n" +
      "- 単位（cm・g・kg・L）と「OEM」はそのまま残す。\n" +
      "- 商品名の固有の部分（例: 超じゅく）は意味に訳さず、音をローマ字で残してよい。\n" +
      "- 用語集の言葉を必ず使う（同じ日本語には同じ訳）。",
    messages: [
      {
        role: "user",
        content:
          `次の日本語を ${target} に訳してください。1つずつ、元の日本語と訳を組にして返してください。\n\n` +
          `用語集（日本語 → 訳）:\n${glossary(lang)}\n\n訳すもの:\n${terms.map((t) => `- ${t}`).join("\n")}`,
      },
    ],
  });
  const out: Record<string, string> = {};
  for (const it of res.parsed_output?.items ?? []) if (terms.includes(it.ja) && it.text.trim()) out[it.ja] = it.text.trim();
  return out;
}

// 書き込みは1つずつ（同時に訳しても消えないように）
let writeQueue: Promise<unknown> = Promise.resolve();
async function save(file: string, lang: Lang, got: Record<string, string>) {
  const run = writeQueue.then(async () => {
    const latest = await readFile(file);
    latest[lang] = { ...(latest[lang] ?? {}), ...got };
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(sortCache(latest), null, 2) + "\n", "utf8");
  });
  writeQueue = run.catch(() => undefined);
  await run;
}

// 裏で訳している語（同じ語を二重に頼まない）と、失敗した語（しばらく頼み直さない）
const inFlight = new Set<string>();
const failedAt = new Map<string, number>();
const RETRY_MS = 10 * 60 * 1000;
const CHUNK = 80;

/** 訳を作って保存する（Claude に聞く）。file を変えると、初期データ用の machine.json に書く */
async function translateAndSave(lang: Lang, terms: string[], file = RUNTIME_FILE): Promise<Record<string, string>> {
  const got: Record<string, string> = {};
  for (let i = 0; i < terms.length; i += CHUNK) Object.assign(got, await askClaude(lang, terms.slice(i, i + CHUNK)));
  if (Object.keys(got).length) await save(file, lang, got);
  return got;
}

/** 裏で訳す（待たない）。訳ができたら次に画面を開いたときから使われる */
function translateInBackground(lang: Lang, terms: string[]) {
  if (!process.env.ANTHROPIC_API_KEY) return;
  const now = Date.now();
  const todo = terms.filter((t) => !inFlight.has(`${lang}|${t}`) && now - (failedAt.get(`${lang}|${t}`) ?? 0) > RETRY_MS);
  if (!todo.length) return;
  todo.forEach((t) => inFlight.add(`${lang}|${t}`));
  translateAndSave(lang, todo)
    .then((got) => todo.filter((t) => !got[t]).forEach((t) => failedAt.set(`${lang}|${t}`, Date.now())))
    .catch((e) => {
      console.error("[translate]", lang, e instanceof Error ? e.message : e);
      todo.forEach((t) => failedAt.set(`${lang}|${t}`, Date.now()));
    })
    .finally(() => todo.forEach((t) => inFlight.delete(`${lang}|${t}`)));
}

/**
 * 日本語の言葉の訳を引く（待たない）。返り値の map は { 日本語: 訳 }、pending はまだ訳が無い語の数。
 * 訳が無い語は裏で Claude に頼む（画面は日本語のまま出し、できたら取り直して差し替える）。
 */
export async function lookupTerms(lang: Lang, terms: string[]): Promise<{ map: Record<string, string>; pending: number }> {
  if (lang === "ja") return { map: {}, pending: 0 };
  const uniq = [...new Set(terms.filter(Boolean))];
  const have = (await readCache())[lang] ?? {};
  const missing = uniq.filter((t) => !have[t]);
  if (missing.length) translateInBackground(lang, missing);
  const working = missing.filter((t) => inFlight.has(`${lang}|${t}`)).length;
  return { map: Object.fromEntries(uniq.filter((t) => have[t]).map((t) => [t, have[t]])), pending: working };
}

/** 前と同じ使い方（待たない版。訳が無い語は返さない） */
export async function translateTerms(lang: Lang, terms: string[]): Promise<Record<string, string>> {
  return (await lookupTerms(lang, terms)).map;
}

/** マスタの中で、工程表・製造計画に出る言葉（商品・生地・工程・設備・トッピング・ライン） */
export function masterTerms(m: Masters): string[] {
  const names = [
    ...m.products.map((x) => x.name),
    ...m.doughs.map((x) => x.name),
    ...m.steps.map((x) => x.name),
    ...m.equipment.map((x) => x.name),
    ...m.toppings.map((x) => x.name),
    ...m.lines.map((x) => x.name),
  ];
  return [...new Set(names.filter((x) => typeof x === "string" && x.trim()))];
}

const OTHER_LANGS = LANGS.map((l) => l.code).filter((c) => c !== "ja") as Lang[];

/** マスタを保存したあとに呼ぶ: 訳が無い語を、10言語ぶん裏でまとめて作る（待たない） */
export async function warmMasterTranslations(m: Masters): Promise<void> {
  const terms = masterTerms(m);
  const cache = await readCache();
  for (const lang of OTHER_LANGS) {
    const missing = terms.filter((t) => !cache[lang]?.[t]);
    if (missing.length) translateInBackground(lang, missing);
  }
}

/** 初期データ用（scripts/pretranslate.ts）: 訳が無い語を全部の言語で訳して、src/i18n/machine.json に書く（待つ） */
export async function pretranslateToSeed(terms: string[], log: (s: string) => void = console.log): Promise<void> {
  const cache = await readCache();
  for (const lang of OTHER_LANGS) {
    const missing = [...new Set(terms)].filter((t) => !cache[lang]?.[t]);
    if (!missing.length) {
      log(`${lang}: 全部あります`);
      continue;
    }
    const got = await translateAndSave(lang, missing, SEED_FILE);
    log(`${lang}: ${Object.keys(got).length} / ${missing.length} 語を訳しました`);
  }
}

const sortCache = (c: Cache) =>
  Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Object.fromEntries(Object.entries(v ?? {}).sort(([a], [b]) => a.localeCompare(b, "ja")))]));
