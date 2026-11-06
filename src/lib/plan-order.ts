import "server-only";
// 作る順番の案（作者 11/6 工場の人の話 P2）。工場の人「最初から適正な順番が並んでいれば、誰でもできる」。
// 生地ごとの 工程表の時刻・締め（便の出発）・ミキサーと回数・ライン から、AI（Sonnet 5.5）が順番の案と、1行の理由を作る。
// キーが無い・上限なら、決まり（工程表のミキシングの始まる順）で作る。人が OK してから印刷する（kv plan_order_<日付>）。
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { aiClient } from "@/lib/ai/client";
import { apiKey } from "@/lib/ai/settings";
import { nowIso } from "@/lib/clock";
import { kvGet, kvSet } from "@/lib/db/sqlite";
import { mixerText } from "@/lib/mixer-plan";
import type { PipelineResult } from "@/lib/pipeline";

export const ORDER_MODEL = "claude-sonnet-5-5";

export interface OrderStep {
  key: string;
  name: string;
  /** 1行の理由 */
  reason: string;
}

export interface PlanOrder {
  date: string;
  steps: OrderStep[];
  /** 全体の一言 */
  note: string;
  by: "AI" | "決まり";
  at: string;
  status: "draft" | "approved";
  approvedBy?: string;
  approvedAt?: string;
}

const K = (date: string) => `plan_order_${date}`;
export const getPlanOrder = (date: string) => kvGet<PlanOrder>(K(date));

const hm = (min: number) => {
  const prev = min < 0;
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${prev ? "前日 " : ""}${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};

/** AI に渡す事実（生地ごと） */
export function orderFacts(r: Pick<PipelineResult, "schedule" | "production">) {
  return r.schedule.map((s) => {
    const d = r.production.doughs.find((x) => x.key === s.key);
    const mix = s.steps.find((x) => x.key === "mix") ?? s.steps[0];
    const last = s.steps.at(-1);
    return {
      key: s.key,
      name: s.doughName + (s.waveName ? `（${s.waveName}）` : ""),
      line: s.line === "pizza" ? "ピザ" : "パン",
      pieces: s.pieces,
      doughKg: d?.doughKg ?? 0,
      mixer: d?.mixer ? mixerText(d.mixer) : `ミキサー ${d?.batches ?? 0}回`,
      mixStart: mix ? hm(mix.start) : "",
      finish: last ? hm(last.end) : "",
      deadline: s.deadlineBasis ?? "",
      products: (d?.items ?? []).map((i) => i.name).slice(0, 6),
      mixStartMin: mix?.start ?? 0,
    };
  });
}

/** 決まりの順番（ミキシングの始まる順） */
export function ruleOrder(facts: ReturnType<typeof orderFacts>): OrderStep[] {
  return [...facts].sort((a, b) => a.mixStartMin - b.mixStartMin).map((f) => ({ key: f.key, name: f.name, reason: `工程表で ${f.mixStart} にミキシングを始める（${f.deadline || `${f.finish} に終わる`}）` }));
}

const Schema = z.object({
  steps: z.array(z.object({ key: z.string(), reason: z.string().describe("その順番にした理由を1行（40字くらい）。締め・ミキサー・生地の色や味の移り・発酵の待ち時間など") })),
  note: z.string().describe("全体の一言（40字くらい）"),
});

/** 順番の案を作る（AI。使えなければ決まり）。保存して返す（まだ OK していない） */
export async function proposePlanOrder(date: string, r: Pick<PipelineResult, "schedule" | "production">): Promise<PlanOrder> {
  const facts = orderFacts(r);
  const rule = ruleOrder(facts);
  let steps = rule;
  let note = "工程表の時刻の順です（AI が使えないため）。";
  let by: PlanOrder["by"] = "決まり";
  if (apiKey() && facts.length > 1) {
    try {
      const res = await aiClient("作る順番の案").beta.messages.parse({
        model: ORDER_MODEL,
        max_tokens: 2000,
        output_config: { format: betaZodOutputFormat(Schema) },
        system:
          "パン・ピザ工場の製造の段取りを考える係です。生地ごとの工程表の時刻・締め（便の出発）・ミキサーと回数から、仕込む順番の案を作ります。" +
          "締めに間に合うことをいちばん大事にし、同じミキサーを続けて使うときは、色や味が移らない順（白い生地 → 色の濃い生地・黒糖、プレーン → 具入り）、発酵の待ちが長い生地を先に、を考える。" +
          "渡された生地の key だけを全部1回ずつ並べ、時刻や数は作らない。理由はやさしい日本語で1行。理由や一言に key（DG04 など）は書かず、生地の名前で書く。",
        messages: [{ role: "user", content: JSON.stringify(facts.map((f) => ({ key: f.key, 生地: f.name, ライン: f.line, 数: f.pieces, 生地kg: f.doughKg, ミキサー: f.mixer, ミキシング開始: f.mixStart, 終わり: f.finish, 締め: f.deadline, 商品: f.products }))) }],
      });
      const out = res.parsed_output;
      const keys = new Set(facts.map((f) => f.key));
      const got = (out?.steps ?? []).filter((s, i, a) => keys.has(s.key) && a.findIndex((x) => x.key === s.key) === i);
      if (out && got.length === facts.length) {
        steps = got.map((s) => ({ key: s.key, name: facts.find((f) => f.key === s.key)!.name, reason: s.reason.trim().slice(0, 80) }));
        note = out.note.trim().slice(0, 120);
        by = "AI";
      }
    } catch {
      /* AI が使えないときは決まりの順番 */
    }
  }
  const p: PlanOrder = { date, steps, note, by, at: nowIso(), status: "draft" };
  kvSet(K(date), p);
  return p;
}

/** 人が OK（順番を直してから OK してもよい）。OK したものだけ印刷に出す */
export function approvePlanOrder(date: string, keys: string[], who: string): PlanOrder {
  if (!who.trim()) throw new Error("OK する人を選んでください");
  const cur = getPlanOrder(date);
  if (!cur) throw new Error("順番の案がありません");
  const steps = keys.map((k) => cur.steps.find((s) => s.key === k)).filter((s): s is OrderStep => !!s);
  if (steps.length !== cur.steps.length) throw new Error("順番の生地が足りません");
  const next: PlanOrder = { ...cur, steps, status: "approved", approvedBy: who, approvedAt: nowIso() };
  kvSet(K(date), next);
  return next;
}
