// 「今日やること」の帯の数（工場の画面だけが使う。トンネル経由は proxy で 403）
// 計算が重い（全注文の集計＋製造計画）ので、結果を30秒ためておく。計算中に来た2本目以降は、同じ計算の結果を待つ。
// 確定・承認のあとは ?fresh=1 で取り直せる（帯の数がすぐ変わるように）。
import { NextResponse } from "next/server";
import { todaySummary, type TodaySummary } from "@/demo/today";

const KEEP_MS = 30_000;
const g = globalThis as unknown as { __today?: { at: number; value?: TodaySummary; running?: Promise<TodaySummary> } };

async function cached(fresh: boolean): Promise<TodaySummary> {
  const c = (g.__today ??= { at: 0 });
  if (c.running) return c.running;
  if (!fresh && c.value && Date.now() - c.at < KEEP_MS) return c.value;
  c.running = todaySummary()
    .then((v) => {
      c.value = v;
      c.at = Date.now();
      return v;
    })
    .finally(() => {
      c.running = undefined;
    });
  return c.running;
}

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  return NextResponse.json(await cached(fresh), { headers: { "cache-control": "no-store" } });
}
