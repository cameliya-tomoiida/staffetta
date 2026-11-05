// 配送コースの見直しの「条件」（⑦の(29)）。AI が配送メモや人の話から作り、人が一覧で見て on/off する。純関数。
//   window   = 時間の希望を変える（例: メモの「10時まで」）
//   service  = 1件の納品の時間（分）
//   closed   = この曜日は回らない（例: 「月曜休み」）
//   backBy   = 〇時までに帰るコースを1つ（例: 「〇〇さんは11時までに帰りたい」）
//   together = この先とこの先は同じコースに
//   info     = 条件にはならないメモ（裏口・鍵など。計算には使わない）
import { z } from "zod";
import type { BackBy, OptStop } from "./optimize";

export const RULE_KINDS = ["window", "service", "closed", "backBy", "together", "info"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export interface RouteRule {
  id: string;
  kind: RuleKind;
  /** 先（window・service・closed・info は1件、together は2件以上） */
  customerIds: string[];
  from?: string;
  to?: string;
  minutes?: number;
  weekdays?: number[];
  /** backBy の時刻 */
  time?: string;
  /** backBy のだれのコースか */
  label?: string;
  /** info の中身 */
  text?: string;
  /** なぜこの条件にしたか（メモのどこを読んだか・だれが言ったか） */
  why: string;
  source: "note" | "chat";
  on: boolean;
}

/** AI の答えの1行（structured outputs 向けに平らな形） */
export const AiRuleSchema = z.object({
  kind: z.enum(RULE_KINDS).describe("window=時間の希望 / service=納品にかかる分 / closed=回らない曜日 / backBy=〇時までに帰るコース / together=同じコースにする先 / info=条件にならないメモ"),
  customerIds: z.array(z.string()).describe("先の id（一覧の id をそのまま）。backBy は空"),
  from: z.string().nullable().describe("window の始まり HH:MM"),
  to: z.string().nullable().describe("window の終わり HH:MM"),
  minutes: z.number().nullable().describe("service の分"),
  weekdays: z.array(z.number()).nullable().describe("closed の曜日（0=日〜6=土）"),
  time: z.string().nullable().describe("backBy の時刻 HH:MM"),
  label: z.string().nullable().describe("backBy のだれか（例: 〇〇さん）"),
  text: z.string().nullable().describe("info の中身（短く）"),
  why: z.string().describe("なぜこの条件か（メモの言葉・人の話）。短く"),
});
export type AiRule = z.infer<typeof AiRuleSchema>;

const HHMM = /^(\d{1,2}):([0-5]\d)$/;
/** "9:00" → "09:00"。おかしければ undefined */
export function normTime(t: string | null | undefined): string | undefined {
  const m = t?.trim().replace("：", ":").match(HHMM);
  if (!m || Number(m[1]) > 23) return undefined;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

let seq = 0;
const newId = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * AI の答えを条件にする。知らない先・おかしい時刻は外して warnings に。
 * keep: 前からある条件（AI が同じ中身を返したら、その id と on を引きつぐ）
 */
export function normalizeRules(
  ai: AiRule[],
  known: Map<string, string>,
  source: RouteRule["source"],
  keep: RouteRule[] = [],
): { rules: RouteRule[]; warnings: string[] } {
  const warnings: string[] = [];
  const rules: RouteRule[] = [];
  for (const a of ai) {
    const ids = [...new Set(a.customerIds)].filter((id) => known.has(id));
    const bad = a.customerIds.filter((id) => !known.has(id));
    if (bad.length) warnings.push(`知らない先を外しました: ${bad.join("・")}`);
    const base = { kind: a.kind, why: a.why.replace("（いまは使っていない）", "").trim(), source, on: true } as const;
    let r: Omit<RouteRule, "id"> | undefined;
    switch (a.kind) {
      case "window": {
        const from = normTime(a.from);
        const to = normTime(a.to);
        if (ids.length && (from || to) && !(from && to && from >= to)) r = { ...base, customerIds: ids.slice(0, 1), ...(from ? { from } : {}), ...(to ? { to } : {}) };
        else warnings.push(`時間の希望を読めませんでした（${a.why}）`);
        break;
      }
      case "service":
        if (ids.length && a.minutes != null && a.minutes > 0 && a.minutes <= 180) r = { ...base, customerIds: ids.slice(0, 1), minutes: Math.round(a.minutes) };
        else warnings.push(`納品の時間を読めませんでした（${a.why}）`);
        break;
      case "closed": {
        const wd = [...new Set(a.weekdays ?? [])].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
        if (ids.length && wd.length) r = { ...base, customerIds: ids.slice(0, 1), weekdays: wd };
        else warnings.push(`回らない曜日を読めませんでした（${a.why}）`);
        break;
      }
      case "backBy": {
        const time = normTime(a.time);
        if (time) r = { ...base, customerIds: [], time, ...(a.label?.trim() ? { label: a.label.trim() } : {}) };
        else warnings.push(`帰る時刻を読めませんでした（${a.why}）`);
        break;
      }
      case "together":
        if (ids.length >= 2) r = { ...base, customerIds: ids };
        else warnings.push(`同じコースにする先が2件そろいませんでした（${a.why}）`);
        break;
      case "info":
        if (ids.length && a.text?.trim()) r = { ...base, customerIds: ids.slice(0, 1), text: a.text.trim() };
        break;
    }
    if (!r) continue;
    const same = keep.find((k) => sameRule(k, r!));
    rules.push(same ? { ...r, id: same.id, on: same.on, source: same.source } : { ...r, id: newId() });
  }
  return { rules, warnings };
}

/** 中身が同じ条件か（id・why・on は見ない） */
export function sameRule(a: Omit<RouteRule, "id">, b: Omit<RouteRule, "id">) {
  const k = (r: Omit<RouteRule, "id">) => JSON.stringify([r.kind, [...r.customerIds].sort(), r.from, r.to, r.minutes, r.weekdays, r.time, r.label, r.text]);
  return k(a) === k(b);
}

/** 条件を先に当てる。on の条件だけ。回らない曜日の先は外す */
export function applyRules<S extends OptStop>(stops: S[], rules: RouteRule[], weekday: number): { stops: S[]; backBy: BackBy[]; together: string[][]; skipped: string[] } {
  const on = rules.filter((r) => r.on);
  const skipped = new Set(on.filter((r) => r.kind === "closed" && r.weekdays?.includes(weekday)).flatMap((r) => r.customerIds));
  const out = stops
    .filter((s) => !skipped.has(s.id))
    .map((s) => {
      let x: S = s;
      for (const r of on) {
        if (!r.customerIds.includes(s.id)) continue;
        if (r.kind === "window") x = { ...x, deliveryWindowFrom: r.from, deliveryWindowTo: r.to };
        if (r.kind === "service" && r.minutes) x = { ...x, serviceMinutes: r.minutes };
      }
      return x;
    });
  const here = new Set(out.map((s) => s.id));
  return {
    stops: out,
    backBy: on.filter((r) => r.kind === "backBy" && r.time).map((r) => ({ time: r.time!, ...(r.label ? { label: r.label } : {}) })),
    together: on.filter((r) => r.kind === "together").map((r) => r.customerIds.filter((id) => here.has(id))).filter((g) => g.length >= 2),
    skipped: stops.filter((s) => skipped.has(s.id)).map((s) => s.id),
  };
}

const WD = "日月火水木金土";
/** 人に見せる一文 */
export function ruleText(r: RouteRule, nameOf: (id: string) => string): string {
  const who = r.customerIds.map(nameOf).join("・");
  switch (r.kind) {
    case "window":
      return `${who}: ${r.from ?? ""}〜${r.to ?? ""} に着く`;
    case "service":
      return `${who}: 納品に ${r.minutes}分`;
    case "closed":
      return `${who}: ${(r.weekdays ?? []).map((d) => WD[d]).join("・")}曜は回らない`;
    case "backBy":
      return `${r.label ? `${r.label}の` : ""}コースを ${r.time} までに帰す`;
    case "together":
      return `${who} を同じコースに`;
    case "info":
      return `${who}: ${r.text}（メモだけ）`;
  }
}

/** AI に渡す、いまの条件（id は渡さない。中身だけ） */
export function rulesForAi(rules: RouteRule[]): AiRule[] {
  return rules.map((r) => ({
    kind: r.kind, customerIds: r.customerIds, from: r.from ?? null, to: r.to ?? null, minutes: r.minutes ?? null, weekdays: r.weekdays ?? null,
    time: r.time ?? null, label: r.label ?? null, text: r.text ?? null, why: r.on ? r.why : `${r.why}（いまは使っていない）`,
  }));
}
