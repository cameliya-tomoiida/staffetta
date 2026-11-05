// ⑤の自動化の API。
//   GET                                   … 設定と、自動で決めたことの記録
//   POST { action: "tick" }               … 決まった時刻の仕事を動かす（タスクスケジューラから数分おきに呼んでよい。同じ区切りに2回は動かない）
//   POST { action: "save", patch, who }   … スイッチ・時刻・上限を変える
//   POST { action: "undo", orderId, who } … 自動で確定した注文を要確認に戻す
import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { listAutoLog } from "@/lib/automation/log";
import { undoAutoConfirm } from "@/lib/automation/orders";
import { automationSettingsChanged, getAutomationSettings, saveAutomationSettings, type AutomationSettings } from "@/lib/automation/settings";
import { runDueAutomations } from "@/lib/automation/tasks";

export async function GET() {
  return NextResponse.json({ settings: getAutomationSettings(), changed: automationSettingsChanged() ?? null, log: listAutoLog(100) });
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as { action: string; patch?: Partial<AutomationSettings>; who?: string; orderId?: string };
    let result: unknown;
    if (b.action === "tick") result = await runDueAutomations();
    else if (b.action === "save") result = saveAutomationSettings(b.patch ?? {}, b.who ?? "");
    else if (b.action === "undo") result = await undoAutoConfirm(b.orderId ?? "", b.who ?? "");
    else throw new Error(`知らない操作です: ${b.action}`);
    revalidatePath("/", "layout");
    return NextResponse.json(result ?? { ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
