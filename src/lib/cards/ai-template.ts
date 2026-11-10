// 製品カードの形を AI と話して直す（⑦の(30)）。AI の答えの形（zod）と、それを CardTemplate に直す純関数。
// 人が「焼成のあとに冷却を足して、温度と時間を書く欄」「ピザは金属検査の後に保管」のように話す → AI が形を全部返す → 画面の見た目に出す。
import { z } from "zod";
import { checkTemplate, customKey, STEP_PRESETS, type CardField, type CardTemplate, type TemplateStep } from "./template";

const n = <T extends z.ZodTypeAny>(t: T) => t.nullable();
const FIELDS = ["time", "staff", "temp", "qty", "check"] as const;

export const AiTemplateSchema = z.object({
  reply: z.string().describe("人への返事。やさしい日本語で1〜3文。何を変えたか・確かめたいこと"),
  template: z.object({
    name: z.string(),
    steps: z.array(
      z.object({
        key: z.string().describe(`工程のキー。よくある工程は ${STEP_PRESETS.map((p) => `${p.key}=${p.name}`).join("・")}。それ以外の新しい工程は "new"`),
        name: z.string().describe("カードに出す工程の名前"),
        fields: z.array(z.enum(FIELDS)).describe("書く欄: time=はじめ・おわりの時刻 / staff=担当者 / temp=温度 / qty=数 / check=○×"),
        tempTarget: n(z.number()),
        tempMin: n(z.number()),
        tempMax: n(z.number()),
        lossLabel: n(z.string()).describe("この工程のロスを製品ごとに書くなら、その見出し（例: 焼成）。書かないなら null"),
        qtyLabel: n(z.string()),
        checkLabel: n(z.string()),
        ccp: z.boolean(),
      }),
    ),
  }),
});
export type AiTemplate = z.infer<typeof AiTemplateSchema>;

/** AI の答えを形にする（キーをそろえる・同じ工程の重なりを外す・null を外す） */
export function normalizeTemplate(a: AiTemplate["template"], base: CardTemplate): { template: CardTemplate; warnings: string[] } {
  const used: string[] = [];
  const steps: TemplateStep[] = [];
  for (const s of a.steps) {
    const known = STEP_PRESETS.find((p) => p.key === s.key) ?? base.steps.find((p) => p.key === s.key);
    let key = known ? s.key : (base.steps.find((p) => p.name === s.name)?.key ?? customKey(s.name, used));
    if (used.includes(key)) key = customKey(s.name, used);
    used.push(key);
    const fields = [...new Set(s.fields)].filter((f): f is CardField => (FIELDS as readonly string[]).includes(f));
    const temp = fields.includes("temp") && (s.tempTarget != null || s.tempMin != null || s.tempMax != null)
      ? { ...(s.tempTarget != null ? { target: s.tempTarget } : {}), ...(s.tempMin != null ? { min: s.tempMin } : {}), ...(s.tempMax != null ? { max: s.tempMax } : {}) }
      : undefined;
    steps.push({
      key, name: s.name.trim() || known?.name || "工程", fields,
      ...(temp ? { temp } : {}), ...(s.lossLabel ? { lossLabel: s.lossLabel } : {}), ...(s.qtyLabel && fields.includes("qty") ? { qtyLabel: s.qtyLabel } : {}),
      ...(s.checkLabel && fields.includes("check") ? { checkLabel: s.checkLabel } : {}), ...(s.ccp ? { ccp: true } : {}),
    });
  }
  const template: CardTemplate = { ...base, name: a.name.trim() || base.name, steps };
  return { template, warnings: checkTemplate(template) };
}

/** AI に渡す、いまの形（キー・名前・欄だけ） */
export function templateText(t: CardTemplate): string {
  return JSON.stringify({ name: t.name, steps: t.steps.map((s) => ({ key: s.key, name: s.name, fields: s.fields, temp: s.temp, lossLabel: s.lossLabel, qtyLabel: s.qtyLabel, checkLabel: s.checkLabel, ccp: !!s.ccp })) });
}

/** A4 横1枚に収まるか（工程の行・製品の行の目安） */
export function fitsOnePage(t: CardTemplate): { ok: boolean; message?: string } {
  const losses = t.steps.filter((s) => s.lossLabel).length;
  if (t.steps.length > 12) return { ok: false, message: `工程が ${t.steps.length} 行あります。A4 横1枚に収まるのは 12 行くらいまでです` };
  if (losses > 5) return { ok: false, message: `ロスの列が ${losses} あります。製品の表が横にはみ出します（5 列くらいまで）` };
  return { ok: true };
}
