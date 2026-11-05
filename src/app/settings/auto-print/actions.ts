"use server";
// 自動印刷の設定（⑦の(23)）の画面から使う処理。
import { revalidatePath } from "next/cache";
import { nowIso } from "@/lib/clock";
import type { PrintSettings } from "@/lib/printing/jobs";
import { getPrintSettings, makeMonthSummary, runPrintJob, savePrintSettings } from "@/lib/printing/auto";

const done = () => revalidatePath("/settings/auto-print");

export async function savePrintSettingsAction(s: PrintSettings) {
  if (!s.printer.trim()) return { ok: false as const, error: "プリンターを選んでください" };
  if (!/^https?:\/\//.test(s.baseUrl)) return { ok: false as const, error: "アプリの住所は http://localhost:3100 のように入れてください" };
  for (const j of s.jobs) {
    if (!/^\d{2}:\d{2}$/.test(j.schedule.time)) return { ok: false as const, error: `「${j.label}」の時刻は 09:00 のように入れてください` };
    if (j.schedule.type === "monthly" && !(j.schedule.day >= 1 && j.schedule.day <= 31)) return { ok: false as const, error: `「${j.label}」の日は 1〜31 で入れてください` };
    if (!(j.copies >= 1 && j.copies <= 20)) return { ok: false as const, error: `「${j.label}」の部数は 1〜20 で入れてください` };
  }
  savePrintSettings({ ...getPrintSettings(), ...s });
  done();
  return { ok: true as const };
}

/** 今すぐ（mode: settings＝設定の仕方どおり＝紙に出すこともある／pdf＝PDF だけ） */
export async function runNowAction(jobId: string, mode: "settings" | "pdf", who: string) {
  const job = getPrintSettings().jobs.find((j) => j.id === jobId);
  if (!job) return { ok: false as const, error: "見つかりません" };
  const r = await runPrintJob(job, nowIso(), who || "画面から", { mode });
  done();
  return r.ok ? { ok: true as const, message: r.message, pdf: r.pdf } : { ok: false as const, error: r.message };
}

/** テスト印刷: 最終退社者スイッチ確認表を1枚（今月） */
export async function testPrintAction(who: string) {
  const r = await runPrintJob({ id: "test", label: "テスト印刷（最終退社者スイッチ確認表）", what: "hygiene-sheet", sheetId: "check-last-out", month: "this", schedule: { type: "daily", time: "00:00" }, copies: 1, on: false }, nowIso(), who || "画面から");
  done();
  return r.ok ? { ok: true as const, message: r.message } : { ok: false as const, error: r.message };
}

export async function makeSummaryAction(month: string) {
  const s = await makeMonthSummary(month, nowIso());
  revalidatePath("/hygiene");
  done();
  return s;
}
