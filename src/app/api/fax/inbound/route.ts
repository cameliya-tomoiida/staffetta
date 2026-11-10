import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { readFaxAction } from "@/app/actions";
import { receiveFax } from "@/lib/fax-inbound";
import { nowIso } from "@/lib/clock";
import { isOn } from "@/lib/settings/features";
import { ensureStore } from "@/lib/db/hub-store";

// Google Apps Script（fax-inbox@example.com のラベル「FAX受信」）からFAXを受け取る口。
// 認証: ヘッダー X-Hub-Token と .env.local の FAX_INBOUND_TOKEN が一致すること。
const Body = z.object({
  messageId: z.string().min(1),
  receivedAt: z.string().min(1),
  subject: z.string().optional(),
  from: z.string().optional(),
  attachments: z.array(z.object({ name: z.string(), base64: z.string() })).min(1),
  via: z.enum(["gmail", "simulate"]).optional(),
});

function authorized(req: Request) {
  const expected = process.env.FAX_INBOUND_TOKEN ?? "";
  const got = req.headers.get("x-hub-token") ?? "";
  if (expected.length < 16 || got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  // 「FAX の受信と読み取り」を使わない設定なら受け取らない（GAS はラベルを残し、使うに戻したあとで送り直す）
  await ensureStore();
  if (!isOn("fax_inbox")) return Response.json({ ok: false, error: "FAX の受信は「使わない」に設定されています" }, { status: 503 });
  try {
    const via = parsed.data.via ?? "gmail";
    // テスト送信（fax:simulate）は、受け取った時刻をデモの時計（DEMO_NOW）にそろえる。本物の Gmail はメールの日時のまま
    const receivedAt = via === "simulate" ? nowIso() : parsed.data.receivedAt;
    const result = await receiveFax({ ...parsed.data, receivedAt, via });
    // 届いたらすぐ読み取りを始める（返事は待たない）
    for (const id of result.faxIds) void readFaxAction(id).catch(() => undefined);
    revalidatePath("/", "layout");
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
