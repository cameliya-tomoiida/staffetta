// 製品カードの形（⑦の(28)・第3版）。純関数と、はじめの形（パン用・ピザ用）。
// 「形」＝ 工程の行の並び。行ごとに書く欄（時刻・担当・温度・数・○×・ロス）を選ぶ。運用が始まってからも画面で
// 足す・外す・並べかえる・一から作るができる（保存は kv の card_templates。/cards/templates の画面）。
// どの生地にどの形を使うか: 生地を選んだ形 → ラインの形（パン・ピザ）→ どれも無ければ工程のマスタから作る。

export type CardField = "time" | "staff" | "temp" | "qty" | "check";

export interface TemplateStep {
  /** 工程のキー（工程のマスタと同じ "mix" "bake" など。自分で足した工程は "x-…"） */
  key: string;
  name: string;
  /** 書く欄 */
  fields: CardField[];
  /** 温度の基準（温度の欄があるとき） */
  temp?: { target?: number; min?: number; max?: number };
  /** この工程で出たロスを、製品の表に書く（見出しの名前） */
  lossLabel?: string;
  /** 数の欄の名前（"冷却した数" など） */
  qtyLabel?: string;
  /** ○×の欄の名前（"保管場所の確認" など） */
  checkLabel?: string;
  ccp?: boolean;
}

export interface CardTemplate {
  id: string;
  name: string;
  /** このラインの生地に使う（生地を選んでいなければ） */
  line?: "bread" | "pizza";
  /** この生地に使う（ラインより先） */
  doughIds?: string[];
  steps: TemplateStep[];
}

/** 画面で足せる工程（自分で名前を付けた工程も足せる） */
export const STEP_PRESETS: TemplateStep[] = [
  { key: "weigh", name: "計量", fields: ["time", "staff"] },
  { key: "mix", name: "ミキサー", fields: ["time", "staff"] },
  { key: "divide", name: "分割", fields: ["time", "staff"] },
  { key: "shape", name: "成形", fields: ["time", "staff"], lossLabel: "分割・成形" },
  { key: "topping", name: "トッピング", fields: ["time", "staff"] },
  { key: "proof", name: "ホイロ", fields: ["time", "staff", "temp"] },
  { key: "bake", name: "焼成", fields: ["time", "staff"], lossLabel: "焼成" },
  { key: "cool", name: "冷却", fields: ["time", "staff"] },
  { key: "freeze", name: "急速冷凍", fields: ["time", "staff", "temp"], temp: { target: -26, min: -28, max: -24 } },
  { key: "slice", name: "スライス", fields: ["time", "staff"] },
  { key: "pack", name: "包装", fields: ["time", "staff"], lossLabel: "包装" },
  { key: "metal_check", name: "金属検査", fields: ["time", "staff"], ccp: true },
  { key: "case_pack", name: "箱詰め", fields: ["time", "staff", "qty"], qtyLabel: "ケース数" },
  { key: "store", name: "保管", fields: ["time", "staff", "check"], checkLabel: "保管場所・温度の確認" },
];
const preset = (key: string, x: Partial<TemplateStep> = {}): TemplateStep => ({ ...STEP_PRESETS.find((p) => p.key === key)!, ...x });

/** はじめの形（パン用・ピザ用）。画面で直せる */
export const DEFAULT_TEMPLATES: CardTemplate[] = [
  {
    id: "bread", name: "パン用", line: "bread",
    steps: [preset("weigh"), preset("mix"), preset("divide"), preset("shape"), preset("bake"), preset("cool"), preset("pack"), preset("metal_check"), preset("store")],
  },
  {
    id: "pizza", name: "ピザ用", line: "pizza",
    steps: [preset("weigh"), preset("mix"), preset("divide"), preset("shape"), preset("topping"), preset("bake"), preset("freeze"), preset("pack"), preset("metal_check"), preset("store")],
  },
];

/** この生地に使う形 */
export function templateFor(templates: CardTemplate[], doughId: string, line: "bread" | "pizza"): CardTemplate | undefined {
  return templates.find((t) => t.doughIds?.includes(doughId)) ?? templates.find((t) => t.line === line && !t.doughIds?.length) ?? templates.find((t) => t.line === line);
}

/** 形を確かめる（おかしい所を日本語で） */
export function checkTemplate(t: CardTemplate): string[] {
  const e: string[] = [];
  if (!t.name.trim()) e.push("形の名前を入れてください");
  if (!t.steps.length) e.push("工程が1つもありません");
  const keys = new Set<string>();
  for (const s of t.steps) {
    if (!s.name.trim()) e.push("名前の無い工程があります");
    if (keys.has(s.key)) e.push(`「${s.name}」が2回あります`);
    keys.add(s.key);
    if (s.temp && s.temp.min != null && s.temp.max != null && s.temp.min > s.temp.max) e.push(`「${s.name}」の温度の下限が上限より大きいです`);
  }
  return e;
}

/** 自分で足す工程のキー */
export const customKey = (name: string, used: string[]) => {
  let i = 1;
  while (used.includes(`x-${i}`)) i++;
  void name;
  return `x-${i}`;
};
