"use server";
// 工場のプリンターで印刷（作者 11/6 (36) B）。スマホ・タブレットのボタンから、3100 が動いている PC で印刷する。
// 役割で印刷できる物を分ける: その印刷の画面を開ける役割だけ（配送は印刷できない）。
import { currentUser } from "@/lib/auth/current-user";
import { canOpen } from "@/lib/auth/roles";
import { nowIso } from "@/lib/clock";
import { getPrintSettings, printNow } from "@/lib/printing/auto";
import { isPrintPage } from "@/lib/printing/print-key";
import { accountsExist } from "@/lib/staff";

async function who(path: string): Promise<string> {
  const pathname = new URL(path, "http://localhost").pathname;
  if (!isPrintPage(pathname)) throw new Error("この画面は工場のプリンターでは印刷できません");
  const u = await currentUser();
  if (accountsExist()) {
    if (!u) throw new Error("ログインしてください");
    if (!canOpen(u.role, pathname)) throw new Error("この役割では印刷できません");
  }
  return u?.name ?? "（ログインなし）";
}

/** プリンターの一覧と、いまの印刷の仕方 */
export async function factoryPrintersAction(path: string) {
  try {
    await who(path);
    const s = getPrintSettings();
    const { listPrinters } = await import("@/lib/printing/printer");
    const names = (await listPrinters()).map((p) => p.name);
    return { ok: true as const, printers: [...new Set([s.printer, ...names])], printer: s.printer, toPaper: s.method === "acrobat" };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function factoryPrintAction(path: string, label: string, copies: number, printer: string) {
  try {
    const name = await who(path);
    const s = getPrintSettings();
    if (printer && printer !== s.printer) {
      const { listPrinters } = await import("@/lib/printing/printer");
      if (!(await listPrinters()).some((p) => p.name === printer)) throw new Error("そのプリンターが見つかりません");
    }
    const log = await printNow({ path, label, copies, printer }, name, nowIso());
    return log.ok ? { ok: true as const, message: log.message, printed: log.printed } : { ok: false as const, error: log.message };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}
