"use server";
// 受注の確認返信の下書きを作る（⑤）。送るのは人（/outbound の「返事の送信待ち」から）。
import { revalidatePath } from "next/cache";
import { createReply } from "@/lib/replies/store";

export async function createReplyAction(orderId: string, who: string): Promise<{ ok: true; kind: "fax" | "email"; late: number; changed: number } | { ok: false; error: string }> {
  try {
    const r = await createReply(orderId, who);
    revalidatePath("/outbound");
    return { ok: true, kind: r.kind, late: r.late, changed: r.changed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
