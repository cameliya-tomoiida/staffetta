// 「PDF で開く」（⑧）: 画面を PDF にして返す（スマホのブラウザで開いて、スマホから印刷・保存できる）。役割で印刷できる画面だけ
import { readFile } from "node:fs/promises";
import { currentUser } from "@/lib/auth/current-user";
import { getPrintSettings } from "@/lib/printing/auto";
import { canPrint } from "@/lib/printing/jobs";
import { printUrl } from "@/lib/printing/pass";
import { accountsExist } from "@/lib/staff";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const path = new URL(req.url).searchParams.get("path") ?? "";
  const user = await currentUser();
  if (accountsExist() && !user) return new Response("ログインしてください", { status: 401 });
  if (!canPrint(user?.role, path)) return new Response("この画面は、この役割では印刷できません", { status: 403 });
  try {
    const { renderPdf } = await import("@/lib/printing/printer");
    const file = await renderPdf(printUrl(getPrintSettings().baseUrl, path, user ? { id: user.id, name: user.name, role: user.role } : undefined), `open-${Date.now()}`);
    const body = await readFile(file);
    return new Response(body, { headers: { "content-type": "application/pdf", "content-disposition": "inline; filename=staffetta.pdf", "cache-control": "no-store" } });
  } catch (e) {
    return new Response(`PDF を作れませんでした: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
  }
}
