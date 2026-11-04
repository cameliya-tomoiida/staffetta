"use client";
// 「CSVで一括登録」「CSVで書き出し」（②の画面）。CSV を読む・検証するのは⑤のエンジン（onImport の先）。
import { useRef, useState, useTransition } from "react";
import { Button, Notice } from "@/components/ui";
import type { ColumnDef, ImportResult, Row } from "./types";

const q = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** 一覧のデータから CSV を作る（見出しは日本語の列名＋キー）。Excel で開けるよう BOM 付き UTF-8 */
function toCsv(columns: ColumnDef[], rows: Row[]) {
  const head = columns.map((c) => q(c.key)).join(",");
  const label = columns.map((c) => q(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => q(r[c.key])).join(","));
  return "﻿" + [head, `# ${label}`, ...body].join("\r\n") + "\r\n";
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function CsvTools({
  name, columns, rows, onImport, exportHref,
}: {
  /** ファイル名のもと（products など） */
  name: string;
  columns: ColumnDef[];
  rows: Row[];
  /** CSV の取り込み（⑤のエンジンを呼ぶ server action。FormData の "file"）。無ければ準備中 */
  onImport?: (fd: FormData) => Promise<ImportResult>;
  /** 書き出しを⑤の API で行うときの URL。無ければ画面の一覧から作る */
  exportHref?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !onImport) return;
    setError(null);
    setResult(null);
    const fd = new FormData();
    fd.append("file", f);
    start(async () => {
      try {
        setResult(await onImport(fd));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input ref={ref} type="file" accept=".csv,text/csv" className="hidden" onChange={pick} />
        <Button disabled={!onImport || pending} onClick={() => ref.current?.click()}>
          {pending ? "読み込んでいます…" : "CSVで一括登録"}
        </Button>
        {exportHref ? (
          <a href={exportHref} className="btn-ghost">
            CSVで書き出し
          </a>
        ) : (
          <Button onClick={() => download(`${name}_${today}.csv`, toCsv(columns, rows))}>CSVで書き出し</Button>
        )}
        <Button variant="quiet" onClick={() => download(`${name}_見本.csv`, toCsv(columns, rows.slice(0, 2)))}>
          見本のCSV
        </Button>
      </div>
      {!onImport && <p className="text-sm text-ink-soft">CSV の一括登録は準備中です。書き出しと見本は今も使えます。</p>}
      {error && <Notice tone="alert">{error}</Notice>}
      {result && (
        <Notice tone={result.errors.length ? "review" : "ok"}>
          <div>
            追加 <span className="num text-xl">{result.added}</span> 件・更新 <span className="num text-xl">{result.updated}</span> 件
            {result.errors.length > 0 && (
              <>
                ・入らなかった行 <span className="num text-xl">{result.errors.length}</span> 件
              </>
            )}
          </div>
          {result.errors.length > 0 && (
            <ul className="mt-1 max-h-48 list-disc overflow-y-auto pl-5 font-normal">
              {result.errors.map((e, i) => (
                <li key={i}>
                  <span className="num font-bold">{e.line}</span> 行目：{e.message}
                </li>
              ))}
            </ul>
          )}
        </Notice>
      )}
    </div>
  );
}
