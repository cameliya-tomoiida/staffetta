// アラートのボタンの先（⑤）。②の画面・①の保存から呼ぶ。下書きを作るまで。送るのは人。
//   POST { kind, who, ...引数 } … kind: draft_po | draft_cost_request | draft_inquiry | mark_cost_reviewed | open_product
//   GET                          … #15 仕入先のお知らせ（終売・価格改定・出荷停止）の一覧
import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { runAlertAction, type AlertActionInput } from "@/lib/alert-actions";
import { listSupplierNotices } from "@/lib/supplier-notices";

export async function GET() {
  return NextResponse.json({ notices: listSupplierNotices() });
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as AlertActionInput;
    const r = await runAlertAction(b);
    revalidatePath("/", "layout");
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
