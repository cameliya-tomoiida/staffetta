import { promises as fs } from "node:fs";
import { faxFilePath } from "@/lib/store";

// 受信したFAXのPDFを画面に出す（data/fax-inbox/ から）
export async function GET(_req: Request, ctx: RouteContext<"/api/fax-file/[id]">) {
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return new Response("not found", { status: 404 });
  try {
    const buf = await fs.readFile(faxFilePath(`/api/fax-file/${id}`));
    return new Response(new Uint8Array(buf), { headers: { "content-type": "application/pdf", "cache-control": "private, max-age=3600" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
