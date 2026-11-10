import { readManual } from "@/lib/hygiene/store";

// 衛生管理のマニュアル（⑦の(21)）を開く。?download=1 なら保存（そのほかは画面で開く）
export async function GET(req: Request, ctx: RouteContext<"/api/hygiene/manuals/[id]">) {
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9-]+$/.test(id)) return new Response("not found", { status: 404 });
  const f = readManual(id);
  if (!f) return new Response("not found", { status: 404 });
  // PDF・画像だけ画面で開く。それ以外（前に入った物も）は保存だけ・中身の種類を推測させない（セキュリティの確認 11/7）
  const safe = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"].includes(f.manual.mime);
  const download = !safe || new URL(req.url).searchParams.get("download") === "1";
  const name = encodeURIComponent(f.manual.fileName);
  return new Response(new Uint8Array(f.bytes), {
    headers: {
      "content-type": safe ? f.manual.mime : "application/octet-stream",
      "x-content-type-options": "nosniff",
      "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${name}`,
      "cache-control": "private, max-age=600",
    },
  });
}
