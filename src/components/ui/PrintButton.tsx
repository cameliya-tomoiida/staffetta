"use client";
// 「工場のプリンターで印刷」（⑧）: スマホ・タブレットからでも、3100 の PC につながった工場の複合機で印刷する。
// 押すと下から出るシートで 部数・プリンター を選ぶ。「PDF で開く」でスマホのブラウザに PDF を出すこともできる。
// path を渡さなければ、いま開いている画面（? も含む）を印刷する。
import { useState, useTransition } from "react";
import { printersAction, printNowAction } from "@/app/print-actions";

const P = (d: string) => (
  <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const PRINTER = "M7 9V3.5h10V9M7 17H4.5V10.5a1.5 1.5 0 0 1 1.5-1.5h12a1.5 1.5 0 0 1 1.5 1.5V17H17M7 14h10v6.5H7z";

export function PrintButton({ path, label, className = "" }: { path?: string; label: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [copies, setCopies] = useState(1);
  const [printers, setPrinters] = useState<string[] | null>(null);
  const [printer, setPrinter] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const target = () => path ?? `${window.location.pathname}${window.location.search}`;
  const show = () => {
    setOpen(true);
    setMsg(null);
    if (printers == null)
      void printersAction().then((r) => {
        if (r.ok) {
          setPrinters(r.printers.length ? r.printers : [r.current]);
          setPrinter(r.current);
        } else setPrinters([]);
      });
  };
  const print = () =>
    start(async () => {
      setMsg(null);
      const r = await printNowAction({ path: target(), label, copies, printer: printer || undefined });
      setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    });
  const big = "flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 px-4 text-[17px] font-bold";
  return (
    <>
      <button type="button" onClick={show} className={`no-print ${big} border-crust-600 bg-sheet text-crust-700 active:bg-crust-50 ${className}`}>
        {P(PRINTER)}
        工場のプリンターで印刷
      </button>
      {open && (
        <div className="no-print fixed inset-0 z-[60] flex flex-col justify-end bg-ink/45 md:items-center md:justify-center" onClick={() => setOpen(false)}>
          <div role="dialog" aria-label="工場のプリンターで印刷" className="m-sheet w-full rounded-t-2xl bg-sheet p-4 shadow-2xl md:max-w-md md:rounded-2xl" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "calc(16px + env(safe-area-inset-bottom))" }}>
            <div className="mb-3 flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[19px] font-black">工場のプリンターで印刷</p>
                <p className="text-[16px] text-ink-soft">{label}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="flex min-h-12 min-w-12 items-center justify-center rounded-lg border-2 border-rule-strong" aria-label="閉じる">
                {P("m6 6 12 12M18 6 6 18")}
              </button>
            </div>
            <p className="mb-1 text-[16px] font-bold">部数</p>
            <div className="mb-3 flex items-center gap-3">
              <button type="button" className={`${big} min-w-14 border-rule-strong`} onClick={() => setCopies((c) => Math.max(1, c - 1))} aria-label="1部へらす">−</button>
              <span className="num min-w-12 text-center text-[28px] font-black">{copies}</span>
              <button type="button" className={`${big} min-w-14 border-rule-strong`} onClick={() => setCopies((c) => Math.min(20, c + 1))} aria-label="1部ふやす">＋</button>
              <span className="text-[17px]">部</span>
            </div>
            <p className="mb-1 text-[16px] font-bold">プリンター</p>
            <div className="mb-4 grid gap-2">
              {printers == null && <p className="text-[16px]">プリンターを調べています…</p>}
              {printers?.length === 0 && <p className="text-[16px]">プリンターの一覧を出せませんでした。設定 → 自動印刷のプリンターで印刷します。</p>}
              {printers?.map((p) => (
                <button key={p} type="button" aria-pressed={printer === p} onClick={() => setPrinter(p)} className={`${big} justify-start text-left ${printer === p ? "border-crust-600 bg-crust-50 text-crust-700" : "border-rule"}`}>
                  {p}
                </button>
              ))}
            </div>
            <button type="button" disabled={pending} onClick={print} className={`${big} w-full border-crust-600 bg-crust-600 text-white disabled:opacity-60`}>
              {pending ? "印刷しています…（1分ほど）" : `${copies}部 印刷する`}
            </button>
            <a href={`/api/print/pdf?path=${encodeURIComponent(path ?? "")}`} onClick={(e) => { e.currentTarget.href = `/api/print/pdf?path=${encodeURIComponent(target())}`; }} target="_blank" rel="noreferrer" className={`${big} mt-2 w-full border-rule-strong`}>
              PDF で開く（このスマホで印刷・保存）
            </a>
            {msg && <p role="status" className={`mt-3 rounded-lg p-3 text-[17px] font-bold ${msg.ok ? "bg-ok-bg text-ok-ink" : "bg-alert-bg text-alert-ink"}`}>{msg.text}</p>}
          </div>
        </div>
      )}
    </>
  );
}
