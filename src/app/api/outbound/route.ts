// 発注の送り出し。発注書の状態は③の purchase-store（data/db.json）に持つ。
//   GET  /api/outbound                                  … 発注書の一覧と出力ファイル
//   POST /api/outbound { action: "load", date }         … ③の計算で、その納品日の発注書の下書きを作って保存
//   POST /api/outbound { action: "receive", drafts }    … 下書きをそのまま保存（承認済み・送信済みは上書きしない）
//   POST /api/outbound { action: "approve", poId, who } … 人が承認 → 出力（PDF・入力リスト・CSV・メール下書き）を作る
//   POST /api/outbound { action: "fax_send", poId }     … 「複合機から送信」（いまはダミー。何も送らない）
//   POST /api/outbound { action: "sent", poId, who }    … 人が送ったあとに「送った」を記録
// ここから外へ送信することはない。
import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { allOrders } from "@/demo/all-orders";
import { runPipeline } from "@/lib/pipeline";
import { receivePurchaseOrder, type ReceiptLine } from "@/lib/stock/store";
import { markReplySent } from "@/lib/replies/store";
import { loadMasters } from "@/lib/masters/seed-db";
import { approvePo, listOutbound, markSent, receiveDrafts } from "@/lib/channels/outbound/workflow";
import type { PoLike } from "@/lib/channels/outbound/render";

export async function GET() {
  return NextResponse.json({ records: await listOutbound() });
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as { action: string; poId?: string; who?: string; drafts?: PoLike[]; date?: string; lines?: ReceiptLine[]; note?: string; replyId?: string };
    let result: unknown;
    if (b.action === "load") {
      if (!b.date || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) throw new Error("納品日を選んでください");
      const { orders } = await allOrders();
      const r = runPipeline(orders, b.date, { masters: await loadMasters() });
      result = await receiveDrafts([...r.productPurchaseOrders, ...r.materialPurchaseOrders], "発注書の計算");
    } else if (b.action === "receive") result = await receiveDrafts(b.drafts ?? []);
    else if (b.action === "approve") result = await approvePo(b.poId ?? "", b.who ?? "");
    else if (b.action === "fax_send") {
      // デモ用のダミー。複合機とはまだつないでいない（docs/fax-sending.md）。状態は変えない
      result = { dummy: true, message: "（デモ）複合機への送信はまだつないでいません。複合機から送ったら「送った」を押してください。" };
    } else if (b.action === "sent") result = await markSent(b.poId ?? "", b.who ?? "");
    else if (b.action === "reply_sent") result = { ...markReplySent(b.replyId ?? "", b.who ?? ""), message: "返事を送信済みにしました" };
    else if (b.action === "arrived") {
      // 入荷（送信済みの発注書が届いた）。届いた量は直せる。材料・包材の在庫に足し、動きを残す
      const r = await receivePurchaseOrder(b.poId ?? "", b.lines, b.who ?? "", b.note);
      result = { ...r, message: `入荷を記録しました（在庫に ${r.moves.length} 品を足しました）` };
      revalidatePath("/masters/materials");
      revalidatePath("/masters/packaging");
      revalidatePath("/", "layout");
    }
    else return NextResponse.json({ error: `知らない操作です: ${b.action}` }, { status: 400 });
    revalidatePath("/outbound");
    revalidatePath("/purchase");
    return NextResponse.json(result ?? { ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
