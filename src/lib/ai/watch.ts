// いつもと違う注文の見張り（AI の案 D・作者 11/6 (34)）。
// 1) 決まりで候補を拾う（純関数 findUnusual）: 取引先 × 商品の「いつもの数」（過去の確定した注文の中央値・3回以上）と比べて、
//    3倍以上・3分の1以下・桁の打ちまちがい（10倍・10分の1）らしいもの
// 2) 候補だけを Claude（Haiku 5.5・安いモデル）に渡して、理由を1文で書いてもらう（無ければ決まりの文）
// 3) お知らせ（判定元 "ai_watch"）にする。理由は注文 × 商品 × 数ごとに覚えておき、同じものは2回 AI に聞かない
import "server-only";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Order } from "@/data/types";
import type { AlertCandidate } from "@/lib/db/alerts-store";
import { kvGet, kvSet } from "@/lib/db/sqlite";
import { aiClient } from "./client";
import { apiKey } from "./settings";

export const WATCH_MODEL = "claude-haiku-5-5";

export interface Unusual {
  key: string;
  orderId: string;
  customerId: string;
  productId: string;
  deliveryDate: string;
  quantity: number;
  usual: number;
  times: number;
  /** 多い・少ない・桁のまちがいかも */
  kind: "多い" | "少ない" | "桁";
  history: number[];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** 候補を拾う（これからの納品の注文だけ。確定・要確認・仮発注） */
export function findUnusual(orders: Order[], today: string): Unusual[] {
  const past = new Map<string, { date: string; q: number }[]>();
  for (const o of orders) {
    if (o.status !== "confirmed" || (o.intent ?? "new") !== "new" || o.deliveryDate >= today) continue;
    for (const l of o.lines) {
      if (!l.productId || l.quantity <= 0) continue;
      const k = `${o.customerId}|${l.productId}`;
      past.set(k, [...(past.get(k) ?? []), { date: o.deliveryDate, q: l.quantity }]);
    }
  }
  const out: Unusual[] = [];
  for (const o of orders) {
    if (o.deliveryDate < today || (o.intent ?? "new") !== "new" || !["confirmed", "needs_review", "provisional"].includes(o.status)) continue;
    for (const l of o.lines) {
      if (!l.productId || l.quantity <= 0) continue;
      const hist = (past.get(`${o.customerId}|${l.productId}`) ?? []).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8).map((h) => h.q);
      if (hist.length < 3) continue;
      const usual = median(hist);
      if (usual <= 0) continue;
      const times = l.quantity / usual;
      const digit = [10, 0.1].some((f) => Math.abs(times - f) / f < 0.15);
      const kind = digit ? "桁" : times >= 3 ? "多い" : times <= 1 / 3 ? "少ない" : null;
      if (!kind) continue;
      out.push({ key: `${o.id}|${l.productId}|${l.quantity}`, orderId: o.id, customerId: o.customerId ?? "", productId: l.productId, deliveryDate: o.deliveryDate, quantity: l.quantity, usual, times: Math.round(times * 10) / 10, kind, history: hist });
    }
  }
  return out;
}

const CACHE = "ai_watch_reasons";
const ReasonSchema = z.object({ reasons: z.array(z.object({ key: z.string(), reason: z.string().describe("やさしい日本語で1文・50字以内。何が・いつもとどう違い・何を確かめるか") })) });

/** 理由（覚えているものは使い回し、新しい候補だけ AI に聞く。AI が使えなければ決まりの文） */
export async function reasonsFor(list: (Unusual & { customerName: string; productName: string })[]): Promise<Map<string, string>> {
  const cache = kvGet<Record<string, string>>(CACHE) ?? {};
  const fresh = list.filter((u) => !cache[u.key]);
  if (fresh.length && apiKey()) {
    try {
      const client = aiClient("いつもと違う注文の見張り");
      const res = await client.beta.messages.parse({
        model: WATCH_MODEL,
        max_tokens: 2000,
        output_config: { format: betaZodOutputFormat(ReasonSchema) },
        system: "パン工場の受注係です。いつもと数がちがう注文について、事務の人が確かめるための理由を1文ずつ書きます。桁の打ちまちがい・行事・人数の変化などの可能性を短く。決めつけない。",
        messages: [{ role: "user", content: JSON.stringify(fresh.slice(0, 20).map((u) => ({ key: u.key, 取引先: u.customerName, 商品: u.productName, 納品日: u.deliveryDate, 今回: u.quantity, いつも: u.usual, 倍: u.times, 見立て: u.kind, 最近の数: u.history }))) }],
      });
      for (const r of res.parsed_output?.reasons ?? []) if (fresh.some((u) => u.key === r.key)) cache[r.key] = r.reason.slice(0, 80);
      const keys = Object.keys(cache);
      kvSet(CACHE, Object.fromEntries(keys.slice(-500).map((k) => [k, cache[k]])));
    } catch {
      /* AI が使えないとき（上限・通信）は、決まりの文で出す */
    }
  }
  const rule = (u: Unusual) => (u.kind === "桁" ? `いつもの約${u.times}倍。桁の打ちまちがいかもしれません` : `いつも ${u.usual} に対して ${u.quantity}（約${u.times}倍）。取引先に確かめましょう`);
  return new Map(list.map((u) => [u.key, cache[u.key] ?? rule(u)]));
}

/** お知らせの判定元（scheduler の ALERT_SOURCES から） */
export async function watchAlerts(now: string): Promise<AlertCandidate[]> {
  const [{ loadDb }, { loadMasters }, { withMasters, findProduct }] = await Promise.all([import("@/lib/db/hub-store"), import("@/lib/masters/seed-db"), import("@/lib/catalog")]);
  const today = new Date(Date.parse(now) + 9 * 3600_000).toISOString().slice(0, 10);
  const masters = await loadMasters();
  const found = findUnusual((await loadDb()).orders, today);
  const named = withMasters(masters, () => found.map((u) => ({ ...u, customerName: masters.customers.find((c) => c.id === u.customerId)?.name ?? u.customerId, productName: findProduct(u.productId)?.name ?? u.productId })));
  const reasons = await reasonsFor(named);
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return named.map((u) => ({
    dedupeKey: `ai_unusual:${u.orderId}:${u.productId}`,
    kind: "ai_unusual",
    level: u.kind === "桁" ? "danger" : "warn",
    title: `${u.customerName}：${u.productName} ${u.quantity}（いつも ${u.usual}・${md(u.deliveryDate)} 納品）`,
    detail: reasons.get(u.key),
    action: "注文を確かめる",
    href: "/orders",
    actions: [{ label: "注文を確かめる", href: "/orders", primary: true }],
  }));
}
