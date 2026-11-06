import "server-only";
// 毎月の自動印刷（⑦の(23)）。スケジューラー（5分ごと・src/lib/scheduler.ts）から runDuePrints が呼ばれる。
//   設定 … kv の auto_print（プリンター・印刷の仕方・印刷するもの）。最初は FAX と同じ複合機・「PDF だけ作る」・全部 OFF
//   記録 … kv の auto_print_log（新しい順に 100 件）
//   印刷の前 … 衛生管理なら「休業日の入れ忘れ・先月の記入もれ・範囲の外なのに措置なし」を見て、お知らせに出す
//   月末 … 「今月の衛生のまとめ」を作る（Claude の API キーがあれば AI が文にする。無ければ決まりの集計だけ）
import { aiClient } from "@/lib/ai/client";
import { apiKey } from "@/lib/ai/settings";
import { syncAlerts, type AlertCandidate } from "@/lib/db/alerts-store";
import { kvGet, kvSet } from "@/lib/db/sqlite";
import { runDays, sheetProblems, type SheetRecord } from "@/lib/hygiene/sheets";
import { holidaysOf, listSheets, recordsOf } from "@/lib/hygiene/store";
import { DEFAULT_PRINT_SETTINGS, dueJobs, monthFor, printPath, type PrintJob, type PrintSettings } from "./jobs";
import { isPrintPage, withPrintKey } from "./print-key";

export function getPrintSettings(): PrintSettings {
  const s = kvGet<PrintSettings>("auto_print");
  return s ? { ...DEFAULT_PRINT_SETTINGS, ...s, jobs: s.jobs ?? DEFAULT_PRINT_SETTINGS.jobs } : { ...DEFAULT_PRINT_SETTINGS, since: new Date().toISOString() };
}
export function savePrintSettings(s: PrintSettings) {
  kvSet("auto_print", { ...s, since: s.since ?? new Date().toISOString() });
}

export interface PrintLog {
  at: string;
  jobId: string;
  label: string;
  ok: boolean;
  /** 紙に出した（false なら PDF を作っただけ） */
  printed: boolean;
  pdf?: string;
  message: string;
  who: string;
}
export const printLog = (): PrintLog[] => kvGet<PrintLog[]>("auto_print_log") ?? [];
function addLog(l: PrintLog) {
  kvSet("auto_print_log", [l, ...printLog()].slice(0, 100));
}

export interface PrintDeps {
  renderPdf: (url: string, fileBase: string) => Promise<string>;
  sendToPrinter: (pdf: string, printer: string, copies: number) => Promise<void>;
}
const realDeps = async (): Promise<PrintDeps> => {
  const p = await import("./printer");
  return { renderPdf: p.renderPdf, sendToPrinter: p.sendToPrinter };
};

/** 1つ印刷する（mode: settings＝設定の仕方どおり／pdf＝PDF だけ作る）。記録を残し、結果を返す */
export async function runPrintJob(job: PrintJob, now: string, who: string, opts: { mode?: "settings" | "pdf"; deps?: PrintDeps } = {}): Promise<PrintLog> {
  const s = getPrintSettings();
  const deps = opts.deps ?? (await realDeps());
  const toPaper = (opts.mode ?? "settings") === "settings" && s.method === "acrobat";
  const url = withPrintKey(`${s.baseUrl.replace(/\/$/, "")}${printPath(job, now)}`);
  let log: PrintLog;
  try {
    if (job.what !== "cards") await precheckHygiene(job.what === "hygiene-sheet" ? job.sheetId : undefined, monthFor(job, now), now);
    const pdf = await deps.renderPdf(url, `${job.id}-${now.slice(0, 16).replace(/[:T]/g, "")}`);
    if (toPaper) await deps.sendToPrinter(pdf, s.printer, job.copies);
    log = { at: now, jobId: job.id, label: job.label, ok: true, printed: toPaper, pdf, message: toPaper ? `${s.printer} に ${job.copies}部 送りました` : "PDF を作りました（紙には出していません）", who };
  } catch (e) {
    log = { at: now, jobId: job.id, label: job.label, ok: false, printed: false, message: e instanceof Error ? e.message : String(e), who };
  }
  addLog(log);
  if (!log.ok) {
    syncAlerts("auto_print", [{ dedupeKey: `print:${job.id}`, kind: "print_failed", level: "warn", title: `自動印刷できませんでした: ${job.label}`, detail: log.message, href: "/settings/auto-print", action: "自動印刷の設定を見る" }], now);
  }
  return log;
}

/**
 * いま印刷する（(36) B: スマホ・タブレットの「工場のプリンターで印刷」）。
 * 3100 が動いている PC が印刷の画面を PDF にして、設定の仕方が「紙に出す」ならプリンターへ送る（「PDF だけ作る」なら PDF だけ）。
 * だれが・いつ・何を印刷したかは、自動印刷と同じ記録（auto_print_log）に残す。
 */
export async function printNow(x: { path: string; label: string; copies: number; printer?: string }, who: string, now: string, deps?: PrintDeps): Promise<PrintLog> {
  const s = getPrintSettings();
  const u = new URL(x.path, "http://localhost");
  if (!isPrintPage(u.pathname)) throw new Error("この画面は工場のプリンターでは印刷できません");
  const copies = Math.min(20, Math.max(1, Math.round(x.copies) || 1));
  const printer = x.printer?.trim() || s.printer;
  const d = deps ?? (await realDeps());
  const toPaper = s.method === "acrobat";
  const url = withPrintKey(`${s.baseUrl.replace(/\/$/, "")}${u.pathname}${u.search}`);
  let log: PrintLog;
  try {
    const pdf = await d.renderPdf(url, `now-${u.pathname.replace(/\W+/g, "_")}-${now.slice(0, 19).replace(/[:T-]/g, "")}`);
    if (toPaper) await d.sendToPrinter(pdf, printer, copies);
    log = { at: now, jobId: "now", label: x.label, ok: true, printed: toPaper, pdf, message: toPaper ? `${printer} に ${copies}部 送りました` : "PDF を作りました（いまの設定は「PDF だけ作る」なので、紙には出していません）", who };
  } catch (e) {
    log = { at: now, jobId: "now", label: x.label, ok: false, printed: false, message: e instanceof Error ? e.message : String(e), who };
  }
  addLog(log);
  return log;
}

/** 印刷の時刻が来たものを印刷する（スケジューラーから）。印刷した日時を残す */
export async function runDuePrints(now: string, deps?: PrintDeps): Promise<PrintLog[]> {
  const s = getPrintSettings();
  const due = dueJobs(s.jobs, now, s.since ?? now);
  const out: PrintLog[] = [];
  for (const job of due) {
    out.push(await runPrintJob(job, now, "自動印刷", { deps }));
    const cur = getPrintSettings();
    savePrintSettings({ ...cur, jobs: cur.jobs.map((j) => (j.id === job.id ? { ...j, lastRunAt: now } : j)) });
  }
  await makeMonthSummaryIfDue(now);
  return out;
}

// ───────── 印刷の前の見直し（決まりのチェック） ─────────

const prevMonth = (m: string) => {
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mm - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** 印刷する月の見直し: 休業日の入れ忘れ・先月の記入もれ・範囲の外なのに措置なし。お知らせに出して、文の一覧を返す */
export async function precheckHygiene(sheetId: string | undefined, month: string, now: string): Promise<string[]> {
  const today = new Date(Date.parse(now) + 9 * 3600_000).toISOString().slice(0, 10);
  const sheets = listSheets().filter((s) => !sheetId || s.id === sheetId);
  const notes: AlertCandidate[] = [];
  if (!holidaysOf(month).length) {
    notes.push({
      dedupeKey: `hygiene:holidays:${month}`, kind: "hygiene_holidays", level: "info", title: `${Number(month.slice(5))}月の工場の休業日が、まだ入っていません`,
      detail: "休業日を入れると、衛生管理のシートでその日が斜線になり、計画の○が入らなくなります。", href: "/hygiene", action: "休業日を確かめる",
    });
  }
  const pm = prevMonth(month);
  const recs = recordsOf(pm);
  for (const s of sheets) {
    const p = sheetProblems(s, recs.get(s.id), pm, today, holidaysOf(pm));
    if (p.length) {
      notes.push({
        dedupeKey: `hygiene:check:${pm}:${s.id}`, kind: "hygiene_missing", level: "warn", title: `${Number(pm.slice(5))}月の「${s.title}」に記入もれ・措置もれがあります（${p.length}件）`,
        detail: p.slice(0, 3).join("／"), href: `/hygiene/${s.id}?month=${pm}`, action: "シートを開く",
      });
    }
  }
  syncAlerts("hygiene", notes, now);
  return notes.map((n) => n.title);
}

// ───────── 月末の「今月の衛生のまとめ」 ─────────

export interface MonthSummary {
  month: string;
  at: string;
  /** 決まりの集計（AI が無くても出す） */
  facts: string[];
  /** AI が書いたまとめ（キーがあるとき） */
  text?: string;
  model?: string;
}
export const getMonthSummary = (month: string) => kvGet<MonthSummary>(`hygiene_summary:${month}`);

/** その月の衛生のまとめを作る（AI はキーがあるときだけ）。保存して返す */
export async function makeMonthSummary(month: string, now: string, ai = !!apiKey()): Promise<MonthSummary> {
  const today = new Date(Date.parse(now) + 9 * 3600_000).toISOString().slice(0, 10);
  const recs = recordsOf(month);
  const holidays = holidaysOf(month);
  const facts: string[] = [];
  for (const s of listSheets()) {
    if (s.kind === "label") continue;
    const rec: SheetRecord | undefined = recs.get(s.id);
    const run = runDays(s, month, holidays).filter((d) => d.date <= today);
    const p = sheetProblems(s, rec, month, today, holidays);
    const filled = s.kind === "temp" ? run.filter((d) => rec?.temps?.[d.date]?.am != null || rec?.temps?.[d.date]?.pm != null).length : run.filter((d) => Object.keys(rec?.done ?? {}).some((k) => k.endsWith(`|${d.date}`))).length;
    const out = s.kind === "temp" ? run.filter((d) => [rec?.temps?.[d.date]?.am, rec?.temps?.[d.date]?.pm].some((v) => v != null && ((s.temp?.min != null && v < s.temp.min) || (s.temp?.max != null && v > s.temp.max)))).length : 0;
    facts.push(`${s.title}: 記入 ${filled}/${run.length}日${out ? `・範囲の外 ${out}日` : ""}${p.length ? `・気になる所 ${p.length}件` : ""}${rec?.approvedBy ? "・責任者確認済み" : ""}`);
  }
  // (36) 記録の漏れ（締めを過ぎても書いていない記録。衛生のシート＋製品カード）
  try {
    const { missingReport } = await import("@/lib/records/store");
    const m = await missingReport(month, now);
    facts.push(m.rows.length ? `記録の漏れ: ${m.rows.length}件（${m.bySheet.map((b) => `${b.title} ${b.count}件`).join("・")}）` : "記録の漏れ: なし");
  } catch {
    /* 漏れの集計ができなくても、まとめは作る */
  }
  const summary: MonthSummary = { month, at: now, facts };
  if (ai) {
    try {
      const client = aiClient("衛生のまとめ", { timeout: 60_000 });
      const res = await client.messages.create({
        model: "claude-opus-5-5",
        max_tokens: 800,
        messages: [{
          role: "user",
          content: `食品工場の衛生管理のチェックシートの、${month} の記入の集計です。工場長が月末に読む「今月の衛生のまとめ」を、やさしい日本語で 3〜6 行で書いてください。よかった所・気をつける所・来月にすることを分けて、箇条書きで。数字は集計にあるものだけ使い、ないことは書かないでください。\n\n${facts.join("\n")}`,
        }],
      });
      summary.text = res.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n").trim();
      summary.model = res.model;
    } catch (e) {
      summary.text = `（AI のまとめは作れませんでした: ${e instanceof Error ? e.message : String(e)}）`;
    }
  }
  kvSet(`hygiene_summary:${month}`, summary);
  return summary;
}

/** 月末（その月の最後の日の 17 時より後）に、まだなら作る */
async function makeMonthSummaryIfDue(now: string) {
  const t = new Date(Date.parse(now) + 9 * 3600_000);
  const tomorrow = new Date(t.getTime() + 24 * 3600_000);
  if (tomorrow.getUTCDate() !== 1 || t.getUTCHours() < 17) return;
  const month = t.toISOString().slice(0, 7);
  if (getMonthSummary(month)) return;
  await makeMonthSummary(month, now);
}
