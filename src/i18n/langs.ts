// 現場向け画面（工程表・製造計画、のちに計量・注文書）の表示言語。
export const LANGS = [
  { code: "ja", native: "日本語", ja: "日本語", htmlLang: "ja" },
  { code: "ja-easy", native: "やさしい にほんご", ja: "やさしい日本語", htmlLang: "ja" },
  { code: "vi", native: "Tiếng Việt", ja: "ベトナム語", htmlLang: "vi" },
  { code: "id", native: "Bahasa Indonesia", ja: "インドネシア語", htmlLang: "id" },
  { code: "zh", native: "简体中文", ja: "中国語（簡体）", htmlLang: "zh-Hans" },
  { code: "ko", native: "한국어", ja: "韓国語", htmlLang: "ko" },
  { code: "fil", native: "Filipino", ja: "フィリピノ語", htmlLang: "fil" },
  { code: "my", native: "မြန်မာ", ja: "ミャンマー語", htmlLang: "my" },
  { code: "ne", native: "नेपाली", ja: "ネパール語", htmlLang: "ne" },
  { code: "en", native: "English", ja: "英語", htmlLang: "en" },
] as const;

export type Lang = (typeof LANGS)[number]["code"];
export const isLang = (s: unknown): s is Lang => LANGS.some((l) => l.code === s);
export const langInfo = (code: Lang) => LANGS.find((l) => l.code === code)!;

/** 現場のタブレットが覚えておく、えらんだことば（cookie の名前） */
export const LANG_COOKIE = "hub_lang";
