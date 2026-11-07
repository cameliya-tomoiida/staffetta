// 在庫の出入りの API（⑤）。
//   GET  ?master=materials|packaging&id=..  … 在庫の動き（新しい順）
//   POST { action: "produce", date, made: [{ productId, pieces }], who } … 製造の実績 → 材料・包材を在庫から引く
//   入荷は /api/outbound の action: "arrived"（送り出しの画面から）
import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { listMoves, recordProduction, type StockMaster } from "@/lib/stock/store";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const master = q.get("master");
  if (master !== "materials" && master !== "packaging") return NextResponse.json({ error: "master は materials か packaging" }, { status: 400 });
  return NextResponse.json({ moves: listMoves(master as StockMaster, q.get("id") ?? undefined) });
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as { action: string; date?: string; made?: { productId: string; pieces: number }[]; who?: string };
    b.who = await (await import("@/lib/auth/acting-user")).actingUser(b.who);
    if (b.action !== "produce") throw new Error(`知らない操作です: ${b.action}`);
    const r = await recordProduction(b.date ?? "", b.made ?? [], b.who ?? "");
    revalidatePath("/", "layout");
    return NextResponse.json({ moves: r.moves, usage: r.usage });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
