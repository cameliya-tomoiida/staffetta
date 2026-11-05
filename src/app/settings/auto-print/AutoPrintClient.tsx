"use client";
// 自動印刷の設定（⑦の(23)）。プリンター・印刷の仕方・印刷するもの（何を・いつ・何部・ON/OFF）・今すぐ・テスト印刷・記録。
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buttonClass, choiceClass } from "@/components/ui";
import { DEFAULT_PRINTER, scheduleText, WD, type PrintJob, type PrintSchedule, type PrintSettings } from "@/lib/printing/jobs";
import type { PrintLog } from "@/lib/printing/auto";
import { runNowAction, savePrintSettingsAction, testPrintAction } from "./actions";

const field = "min-h-14 w-full rounded-lg border-2 border-rule-strong bg-sheet px-3 text-lg";
const fmt = (iso: string) => new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });

export function AutoPrintClient({
  settings, printers, next, log, sheets, tools,
}: { settings: PrintSettings; printers: { name: string; port: string }[]; next: Record<string, string>; log: PrintLog[]; sheets: { id: string; title: string }[]; tools: { browser: boolean; acrobat: boolean } }) {
  const router = useRouter();
  const [s, setS] = useState<PrintSettings>(settings);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [confirmPaper, setConfirmPaper] = useState<string | null>(null);
  const dirty = JSON.stringify(s) !== JSON.stringify(settings);
  const setJob = (id: string, x: Partial<PrintJob>) => setS({ ...s, jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...x } : j)) });
  const setSched = (id: string, x: PrintSchedule) => setJob(id, { schedule: x });
  const save = () =>
    start(async () => {
      const r = await savePrintSettingsAction(s);
      setMsg(r.ok ? { ok: true, text: "保存しました" } : { ok: false, text: r.error });
      if (r.ok) router.refresh();
    });
  const runNow = (id: string, mode: "settings" | "pdf") =>
    start(async () => {
      setMsg({ ok: true, text: mode === "pdf" ? "PDF を作っています（1分ほど）…" : "印刷しています（1分ほど）…" });
      const r = await runNowAction(id, mode, "画面から");
      setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      setConfirmPaper(null);
      router.refresh();
    });
  const testPrint = () =>
    start(async () => {
      setMsg({ ok: true, text: "テスト印刷をしています…" });
      const r = await testPrintAction("画面から");
      setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      setConfirmPaper(null);
      router.refresh();
    });
  const knownPrinter = printers.some((p) => p.name === s.printer);
  const paper = s.method === "acrobat";

  return (
    <div className="space-y-6">
      {msg && <p role="status" className={`rounded-lg border-2 p-4 text-xl ${msg.ok ? "border-ok-line bg-ok-bg text-ok-ink" : "border-alert-line bg-alert-bg text-alert-ink"}`}>{msg.text}</p>}

      {/* プリンターと印刷の仕方 */}
      <section className="card space-y-4 p-5">
        <h2 className="text-2xl font-bold">プリンター</h2>
        <label className="flex flex-col gap-1 text-lg font-bold">
          どのプリンターで印刷するか
          <select className={field} value={s.printer} onChange={(e) => setS({ ...s, printer: e.target.value })}>
            {!knownPrinter && <option value={s.printer}>{s.printer}（このパソコンに見つかりません）</option>}
            {printers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}（{p.port}）{p.name === DEFAULT_PRINTER ? "　← FAX と同じ複合機" : ""}
              </option>
            ))}
          </select>
        </label>
        <p className="text-lg text-ink-soft">プリンターが変わったら、ここで選び直して「保存」。一覧はこのパソコンに入っているプリンターです。</p>
        <fieldset>
          <legend className="text-lg font-bold">印刷の仕方</legend>
          <div className="mt-1 flex flex-wrap gap-3">
            <button type="button" aria-pressed={!paper} className={choiceClass(!paper, "min-h-14 px-5 text-lg")} onClick={() => setS({ ...s, method: "pdf-only" })}>
              PDF だけ作る（紙に出さない・ためし）
            </button>
            <button type="button" aria-pressed={paper} className={choiceClass(paper, "min-h-14 px-5 text-lg")} onClick={() => setS({ ...s, method: "acrobat" })}>
              紙に印刷する
            </button>
          </div>
        </fieldset>
        <p className="text-lg">
          PDF にする道具: {tools.browser ? "✓ あり（Chrome／Edge）" : "！ ありません"}　紙に出す道具: {tools.acrobat ? "✓ あり（Adobe Acrobat）" : "！ ありません（紙に出すときは Adobe Acrobat が要ります）"}
        </p>
        <details>
          <summary className="cursor-pointer text-lg">くわしい設定</summary>
          <label className="mt-2 flex flex-col gap-1 text-lg">
            アプリの住所（PDF にする画面を開く元）
            <input className={field} value={s.baseUrl} onChange={(e) => setS({ ...s, baseUrl: e.target.value })} />
          </label>
        </details>
      </section>

      {/* 印刷するもの */}
      <section className="space-y-4">
        <h2 className="text-2xl font-bold">印刷するもの</h2>
        {s.jobs.map((j) => (
          <div key={j.id} className={`card space-y-3 p-5 ${j.on ? "border-2 border-crust-600" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-xl font-bold">{j.label}</h3>
              <button type="button" aria-pressed={j.on} className={choiceClass(j.on, "min-h-12 px-5 text-lg")} onClick={() => setJob(j.id, { on: !j.on })}>
                {j.on ? "ON（自動で印刷する）" : "OFF"}
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <label className="flex flex-col gap-1 text-lg">
                いつ
                <select
                  className={field}
                  value={j.schedule.type}
                  onChange={(e) => {
                    const t = e.target.value;
                    setSched(j.id, t === "monthly" ? { type: "monthly", day: 25, time: j.schedule.time } : t === "weekly" ? { type: "weekly", weekday: 1, time: j.schedule.time } : { type: "daily", time: j.schedule.time });
                  }}
                >
                  <option value="monthly">毎月</option>
                  <option value="weekly">毎週</option>
                  <option value="daily">毎日</option>
                </select>
              </label>
              {j.schedule.type === "monthly" && (
                <label className="flex flex-col gap-1 text-lg">
                  日
                  <input inputMode="numeric" className={`${field} num text-right`} value={j.schedule.day} onChange={(e) => setSched(j.id, { ...j.schedule, day: Number(e.target.value.replace(/\D/g, "")) || 1 } as PrintSchedule)} />
                </label>
              )}
              {j.schedule.type === "weekly" && (
                <label className="flex flex-col gap-1 text-lg">
                  曜日
                  <select className={field} value={j.schedule.weekday} onChange={(e) => setSched(j.id, { ...j.schedule, weekday: Number(e.target.value) } as PrintSchedule)}>
                    {[...WD].map((w, i) => (
                      <option key={w} value={i}>{w}曜</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex flex-col gap-1 text-lg">
                時刻
                <input type="time" className={field} value={j.schedule.time} onChange={(e) => setSched(j.id, { ...j.schedule, time: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-lg">
                部数
                <input inputMode="numeric" className={`${field} num text-right`} value={j.copies} onChange={(e) => setJob(j.id, { copies: Number(e.target.value.replace(/\D/g, "")) || 1 })} />
              </label>
              {j.what !== "cards" && (
                <label className="flex flex-col gap-1 text-lg">
                  どの月
                  <select className={field} value={j.month ?? "next"} onChange={(e) => setJob(j.id, { month: e.target.value as "next" | "this" })}>
                    <option value="next">来月の分</option>
                    <option value="this">今月の分</option>
                  </select>
                </label>
              )}
              {j.what === "hygiene-sheet" && (
                <label className="flex flex-col gap-1 text-lg md:col-span-2">
                  シート
                  <select className={field} value={j.sheetId ?? ""} onChange={(e) => setJob(j.id, { sheetId: e.target.value })}>
                    {sheets.map((x) => (
                      <option key={x.id} value={x.id}>{x.title}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <p className="text-lg">
              {scheduleText(j.schedule)}・{j.copies}部　次に印刷: <b>{j.on && next[j.id] ? fmt(next[j.id]) : "（OFF）"}</b>
              {j.lastRunAt ? `　前に印刷: ${fmt(j.lastRunAt)}` : ""}
            </p>
            <div className="flex flex-wrap gap-3">
              <button type="button" className={buttonClass("ghost", "md")} disabled={pending || dirty} onClick={() => runNow(j.id, "pdf")}>
                今すぐ PDF を作る（紙に出さない）
              </button>
              {paper &&
                (confirmPaper === j.id ? (
                  <>
                    <button type="button" className={buttonClass("primary", "md")} disabled={pending || dirty} onClick={() => runNow(j.id, "settings")}>
                      {s.printer} で {j.copies}部 印刷する
                    </button>
                    <button type="button" className={buttonClass("quiet", "md")} onClick={() => setConfirmPaper(null)}>
                      やめる
                    </button>
                  </>
                ) : (
                  <button type="button" className={buttonClass("ghost", "md")} disabled={pending || dirty} onClick={() => setConfirmPaper(j.id)}>
                    今すぐ印刷する
                  </button>
                ))}
            </div>
          </div>
        ))}
        <button
          type="button"
          className={buttonClass("quiet", "md")}
          onClick={() => setS({ ...s, jobs: [...s.jobs, { id: `job-${Date.now().toString(36)}`, label: "衛生管理のシート（1枚）", what: "hygiene-sheet", sheetId: sheets[0]?.id, month: "next", schedule: { type: "monthly", day: 25, time: "09:00" }, copies: 1, on: false }] })}
        >
          ＋ 衛生管理のシートを1枚だけ印刷するものを足す
        </button>
      </section>

      <div className="flex flex-wrap items-center gap-4">
        <button type="button" className={buttonClass("primary", "lg")} disabled={pending || !dirty} onClick={save}>
          保存
        </button>
        {dirty && <span className="text-lg text-review-ink">まだ保存していません（今すぐ印刷は、保存してから）</span>}
        {paper &&
          (confirmPaper === "test" ? (
            <>
              <button type="button" className={buttonClass("ghost", "lg")} disabled={pending || dirty} onClick={testPrint}>
                {s.printer} で1枚 印刷する
              </button>
              <button type="button" className={buttonClass("quiet", "lg")} onClick={() => setConfirmPaper(null)}>
                やめる
              </button>
            </>
          ) : (
            <button type="button" className={buttonClass("ghost", "lg")} disabled={pending || dirty} onClick={() => setConfirmPaper("test")}>
              テスト印刷（1枚）
            </button>
          ))}
      </div>

      {/* 記録 */}
      <section className="card p-5">
        <h2 className="text-2xl font-bold">印刷の記録</h2>
        {!log.length && <p className="mt-2 text-lg">まだありません。</p>}
        <ul className="mt-2 space-y-2">
          {log.map((l, i) => (
            <li key={i} className={`text-lg ${l.ok ? "" : "font-bold text-alert-ink"}`}>
              {fmt(l.at)}　{l.ok ? "✓" : "✕"} {l.label}：{l.message}（{l.who}）
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
