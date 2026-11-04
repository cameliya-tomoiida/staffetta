// 発注の送り出し。
//   GET  /api/outbound                         … 発注書の一覧（下書き・承認済み・送信済み）
//   POST /api/outbound { action: "receive", drafts }   … ③の下書きを受け取る
//   POST /api/outbound { action: "demo" }              … デモ用の下書きを入れる
//   POST /api/outbound { action: "approve", poId, who } … 人が承認 → 出力（PDF・入力リスト・CSV・メール下書き）を作る
//   POST /api/outbound { action: "sent", poId, who }    … 人が送ったあとに「送った」を記録
//   POST /api/outbound { action: "draft", poId, who }   … 承認を取り消す（送る前だけ）
// ここから外へ送信することはない。
import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { approvePo, backToDraft, demoDrafts, listOutbound, markSent, receiveDrafts, resetOutbound } from "@/lib/channels/outbound/workflow";
import type { PoLike } from "@/lib/channels/outbound/render";

export async function GET() {
  return NextResponse.json({ records: await listOutbound() });
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as { action: string; poId?: string; who?: string; drafts?: PoLike[]; deliveryDate?: string };
    let result: unknown;
    if (b.action === "receive") result = await receiveDrafts(b.drafts ?? []);
    else if (b.action === "demo") result = await receiveDrafts(demoDrafts(b.deliveryDate));
    else if (b.action === "approve") result = await approvePo(b.poId ?? "", b.who ?? "");
    else if (b.action === "sent") result = await markSent(b.poId ?? "", b.who ?? "");
    else if (b.action === "draft") result = await backToDraft(b.poId ?? "", b.who ?? "");
    else if (b.action === "reset") result = await resetOutbound();
    else return NextResponse.json({ error: `知らない操作です: ${b.action}` }, { status: 400 });
    revalidatePath("/outbound");
    return NextResponse.json(result ?? { ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
