"use client";
// 「工場のプリンターで印刷」（作者 11/6 (36) B）。パソコンが無い人でも、スマホ・タブレットから工場の複合機に印刷できる。
// 押すと部数・プリンターを選ぶ欄が開き、「印刷する」で 3100 の PC が PDF にしてプリンターへ送る（設定が「PDF だけ作る」なら PDF だけ）。
// 「PDF で開く」は、このスマホ・タブレットのブラウザで開いて、そこから印刷・保存する（今までのやり方）。
import { useState, useTransition } from "react";
import { Icon } from "@/components/ui";
import { factoryPrintAction, factoryPrintersAction } from "@/app/print-actions";

export function FactoryPrint({ path, label, openHref }: { path: string; label: string; openHref?: string }) {
  const [open, setOpen] = useState(false);
  const [copies, setCopies] = useState(1);
  const [printers, setPrinters] = useState<string[]>([]);
  const [printer, setPrinter] = useState("");
  const [toPaper, setToPaper] = useState<boolean>();
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [pending, start] = useTransition();

  const show = () => {
    setOpen((o) => !o);
    setMsg(undefined);
    if (printers.length) return;
    start(async () => {
      const r = await factoryPrintersAction(path);
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setPrinters(r.printers);
      setPrinter(r.printer);
      setToPaper(r.toPaper);
    });
  };
  const print = () =>
    start(async () => {
      setMsg(undefined);
      const r = await factoryPrintAction(path, label, copies, printer);
      setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    });

  return (
    <div className="no-print">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={show} aria-expanded={open} className="btn-primary w-full whitespace-nowrap text-lg sm:w-auto sm:text-xl">
          <Icon.print className="h-5 w-5" />
          工場のプリンターで印刷
        </button>
        {openHref && (
          <a href={openHref} target="_blank" rel="noreferrer" className="btn-ghost w-full text-xl sm:w-auto">
            PDF で開く（この端末で印刷）
          </a>
        )}
      </div>
      {open && (
        <div className="mt-3 max-w-xl space-y-3 rounded-xl border-2 border-rule-strong bg-sheet p-4">
          <div className="text-lg font-bold">{label}</div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-lg">部数</span>
            <button type="button" aria-label="1部へらす" onClick={() => setCopies((c) => Math.max(1, c - 1))} className="btn-ghost h-14 w-14 text-2xl">−</button>
            <span className="num w-10 text-center text-2xl font-bold" aria-live="polite">{copies}</span>
            <button type="button" aria-label="1部ふやす" onClick={() => setCopies((c) => Math.min(20, c + 1))} className="btn-ghost h-14 w-14 text-2xl">＋</button>
          </div>
          <label className="block space-y-1">
            <span className="text-lg">プリンター</span>
            <select value={printer} onChange={(e) => setPrinter(e.target.value)} className="min-h-14 w-full rounded-lg border-2 border-rule-strong bg-sheet px-3 text-xl">
              {printers.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          {toPaper === false && (
            <p className="text-base text-ink-soft">いまは「PDF だけ作る」の設定です（紙には出ません）。紙に出すときは、設定 → 自動印刷 で「紙に出す」にします。</p>
          )}
          <button type="button" onClick={print} disabled={pending || !printer} className="btn-primary w-full text-xl">
            {pending ? "送っています…" : `${copies}部 印刷する`}
          </button>
          {msg && <p role="status" className={`text-lg font-bold ${msg.ok ? "text-ok-ink" : "text-alert-ink"}`}>{msg.text}</p>}
        </div>
      )}
    </div>
  );
}
