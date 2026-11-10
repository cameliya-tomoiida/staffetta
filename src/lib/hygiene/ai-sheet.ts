// 衛生チェックシートを AI とのチャットで作る（⑦の(24)）。
//   人が声・文章で「ピザの冷蔵庫、1日2回、5℃以下」と話す → AI がシートの下書き（形・項目・基準・回数・曜日）と返事、足りない所の提案を返す
//   → 「ここを変えて」で何度でも直す → 画面の「登録」で今の衛生管理のシートとして使う。
// ここは AI の出す形（zod）と、それを SheetDef に直す純関数（normalizeDraft）。AI を呼ぶのは chatSheet（サーバーだけ）。
import { z } from "zod";
import type { Freq, SheetDef, SheetKind } from "./sheets";

const n = <T extends z.ZodTypeAny>(t: T) => t.nullable();

export const AiSheetSchema = z.object({
  reply: z.string().describe("人への返事。やさしい日本語で2〜4文。何を作ったか・何を変えたか・確かめたいこと"),
  suggestions: z.array(z.string()).describe("HACCP の考え方で、足りないと思うチェックの提案（0〜3つ。短く）"),
  sheet: z.object({
    title: z.string().describe("シートの名前（例: ピザ冷蔵庫 温度管理表）"),
    kind: z.enum(["temp", "clean", "check", "log", "label"]).describe("temp=温度の記録 / clean=点検清掃（頻度で○計画→●実施） / check=毎日のチェック（✓） / log=記録の表（1行ずつ） / label=ラベル"),
    area: n(z.string()).describe("区域・ライン（ピザ・パン・米飯・原料・全体 など）"),
    rule: n(z.string()).describe("用紙の上に出す決まり・基準・外れたときの措置"),
    weekdays: z.array(z.number().int().min(0).max(6)).describe("記入する曜日（0=日〜6=土）。毎日なら空"),
    temp: n(
      z.object({
        unit: z.string(),
        set: n(z.number()),
        min: n(z.number()).describe("管理範囲の下限"),
        max: n(z.number()).describe("管理範囲の上限"),
        humidity: z.boolean().describe("湿度も書くか"),
        perDay: z.union([z.literal(1), z.literal(2)]).describe("1日の回数（2なら①午前②午後）"),
        scale: n(z.array(z.number())).describe("印刷の目盛り（上から。●を打つ形にするとき。8〜12個）。数字を書く形なら null"),
      }),
    ).describe("kind が temp のときだけ"),
    items: n(
      z.array(
        z.object({
          name: z.string(),
          note: n(z.string()),
          freq: n(z.enum(["daily", "weekly", "biweekly", "monthly", "twice"])).describe("clean のとき: 毎日・週1・2週に1・月1・週2"),
          weekday: n(z.number().int().min(0).max(6)).describe("週1・2週に1の曜日"),
          owner: n(z.string()),
          qty: n(z.number()).describe("check で数を数えるとき（備品など）"),
          group: n(z.string()).describe("まとまり（設備・場所）"),
        }),
      ),
    ).describe("kind が clean・check のとき"),
    columns: n(
      z.array(z.object({ key: z.string().describe("英字のキー"), label: z.string(), type: z.enum(["text", "number", "okng", "date"]), width: n(z.number()) })),
    ).describe("kind が log のとき（日付・確認者・措置の列を入れる）"),
  }),
});
export type AiSheet = z.infer<typeof AiSheetSchema>;

const FREQS: Freq[] = ["daily", "weekly", "biweekly", "monthly", "twice"];

/** AI の下書きを SheetDef にする（null を外す・ID を振る・形に合わない所を直す） */
export function normalizeDraft(a: AiSheet["sheet"], id: string): { def: SheetDef; warnings: string[] } {
  const warnings: string[] = [];
  const kind = a.kind as SheetKind;
  const def: SheetDef = { id, title: a.title.trim() || "新しいシート", kind, ...(a.area ? { area: a.area } : {}), ...(a.rule ? { rule: a.rule } : {}) };
  const wd = [...new Set(a.weekdays.filter((d) => d >= 0 && d <= 6))].sort();
  if (wd.length && wd.length < 7) def.weekdays = wd;
  if (kind === "temp") {
    const t = a.temp;
    if (!t) warnings.push("温度の基準がまだありません");
    def.temp = {
      unit: t?.unit || "℃", perDay: t?.perDay === 1 ? 1 : 2, ...(t?.set != null ? { set: t.set } : {}), ...(t?.min != null ? { min: t.min } : {}), ...(t?.max != null ? { max: t.max } : {}),
      ...(t?.humidity ? { humidity: true } : {}), ...(t?.scale?.length ? { scale: [...t.scale].sort((x, y) => y - x) } : {}),
    };
  }
  if (kind === "clean" || kind === "check") {
    const items = a.items ?? [];
    if (!items.length) warnings.push("項目がまだありません");
    def.items = items.map((x, i) => ({
      id: `a${i + 1}`, name: x.name.trim(),
      ...(x.note ? { note: x.note } : {}), ...(kind === "clean" ? { freq: x.freq && FREQS.includes(x.freq) ? x.freq : "daily" } : {}),
      ...(x.weekday != null ? { weekday: x.weekday } : {}), ...(x.owner ? { owner: x.owner } : {}), ...(x.qty != null ? { qty: x.qty } : {}), ...(x.group ? { group: x.group } : {}),
    }));
  }
  if (kind === "log") {
    const cols = a.columns ?? [];
    if (!cols.length) warnings.push("記録の列がまだありません");
    const used = new Set<string>();
    def.columns = cols.map((c, i) => {
      let key = c.key.replace(/[^A-Za-z0-9_]/g, "") || `c${i + 1}`;
      while (used.has(key)) key = `${key}${i}`;
      used.add(key);
      return { key, label: c.label, type: c.type, ...(c.width ? { width: c.width } : {}) };
    });
  }
  return { def, warnings };
}

/** いまの下書きを AI に渡す文（AI はこれを直して返す） */
export function draftText(def?: SheetDef): string {
  if (!def) return "（まだ下書きはありません）";
  const { id: _id, ...rest } = def;
  void _id;
  return JSON.stringify(rest, null, 1);
}
