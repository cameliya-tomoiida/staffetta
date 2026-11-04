// 「今日やること」の帯の数（工場の画面だけが使う。トンネル経由は proxy で 403）
import { NextResponse } from "next/server";
import { todaySummary } from "@/demo/today";

export async function GET() {
  return NextResponse.json(await todaySummary(), { headers: { "cache-control": "no-store" } });
}
