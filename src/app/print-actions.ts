"use server";
// 「工場のプリンターで印刷」（⑧）のボタンの処理。押した人の役割で、印刷できる画面か確かめてから印刷する。
import { currentUser } from "@/lib/auth/current-user";
import { printNow } from "@/lib/printing/auto";
import { canPrint } from "@/lib/printing/jobs";
import { accountsExist } from "@/lib/staff";

export async function printNowAction(x: { path: string; label: string; copies: number; printer?: string }) {
  const user = await currentUser();
  if (accountsExist() && !user) return { ok: false as const, error: "ログインしてください" };
  if (!canPrint(user?.role, x.path)) return { ok: false as const, error: "この画面は、この役割では印刷できません" };
  const log = await printNow({ ...x, who: user?.name ?? "（ログインなし）", user: user ? { id: user.id, name: user.name, role: user.role } : undefined }, new Date().toISOString());
  return log.ok ? { ok: true as const, printed: log.printed, message: log.message } : { ok: false as const, error: log.message };
}

/** 選べるプリンター（3100 の PC につながっているもの） */
export async function printersAction() {
  try {
    const { listPrinters } = await import("@/lib/printing/printer");
    const { getPrintSettings } = await import("@/lib/printing/auto");
    return { ok: true as const, printers: (await listPrinters()).map((p) => p.name), current: getPrintSettings().printer };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}
