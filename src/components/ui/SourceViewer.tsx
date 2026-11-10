"use client";
// 元の資料を開く（FAXのPDF・LINEの文面・メール・シート・取込CSV・聞き取りメモ）
import { useEffect, useState } from "react";
import type { OrderSource, SourceRef } from "@/data/types";
import { Button, buttonClass, ChannelBadge, fmtDateTime, Icon } from "./index";

/** 1タップで元を開くボタン。PDF やURLのあるものは新しいタブで直接開く */
export function SourceButton({ source, size = "md" }: { source: OrderSource; size?: "md" | "lg" }) {
  const [open, setOpen] = useState(false);
  const first = source.refs[0];
  const direct = first && directUrl(first);
  if (direct)
    return (
      <a href={direct} target="_blank" rel="noreferrer" className={buttonClass("ghost", size, "no-print")}>
        <Icon.open className="h-5 w-5" />
        元を開く
      </a>
    );
  return (
    <>
      <Button size={size} className="no-print" onClick={() => setOpen(true)}>
        <Icon.open className="h-5 w-5" />
        元を見る
      </Button>
      {open && <SourceSheet source={source} onClose={() => setOpen(false)} />}
    </>
  );
}

function directUrl(r: SourceRef): string | null {
  if (r.kind === "fax_pdf") return r.pdfUrl + (r.page ? `#page=${r.page}` : "");
  if (r.kind === "google_sheet") return r.url;
  if (r.kind === "screenshot" && r.imageUrl) return r.imageUrl;
  return null;
}

function SourceSheet({ source, onClose }: { source: OrderSource; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-t-xl border border-rule-strong bg-sheet p-5 sm:rounded-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="mb-3 flex items-center gap-2">
          <ChannelBadge channel={source.channel} />
          <span className="text-sm text-ink-soft">{fmtDateTime(source.receivedAt)} 受付</span>
          {source.externalId && <span className="text-sm text-ink-soft">伝票 {source.externalId}</span>}
        </div>
        <div className="space-y-3">
          {source.refs.map((r, i) => (
            <RefBody key={i} r={r} />
          ))}
          {source.rawText && !source.refs.some((r) => r.kind === "line_message" && r.text) && (
            <div className="rounded-lg border border-rule bg-paper p-3 whitespace-pre-wrap">{source.rawText}</div>
          )}
        </div>
        <Button size="lg" className="mt-5 w-full" onClick={onClose}>
          閉じる
        </Button>
      </div>
    </div>
  );
}

function RefBody({ r }: { r: SourceRef }) {
  switch (r.kind) {
    case "line_message":
      return (
        <div>
          <div className="mb-1 text-sm text-ink-soft">LINE のメッセージ</div>
          <div className="inline-block max-w-full rounded-2xl rounded-tl-sm border border-rule bg-cream px-4 py-3 text-lg whitespace-pre-wrap">{r.text ?? "（本文なし）"}</div>
        </div>
      );
    case "email":
      return (
        <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1">
          <dt className="text-ink-soft">件名</dt>
          <dd className="font-bold">{r.subject ?? "—"}</dd>
          <dt className="text-ink-soft">差出人</dt>
          <dd className="break-all">{r.from ?? "—"}</dd>
          {r.attachmentName && (
            <>
              <dt className="text-ink-soft">添付</dt>
              <dd>{r.attachmentName}</dd>
            </>
          )}
        </dl>
      );
    case "csv":
      return (
        <div>
          取込ファイル <b>{r.fileName}</b>
          {r.rowStart != null && (
            <span className="text-ink-soft">
              （{r.rowStart}〜{r.rowEnd ?? r.rowStart} 行目）
            </span>
          )}
        </div>
      );
    case "screenshot":
      return (
        <div>
          {r.site ?? "サイト"} の画面
          {r.pageUrl && (
            <a className="ml-2 font-bold text-crust-700 underline" href={r.pageUrl} target="_blank" rel="noreferrer">
              サイトを開く
            </a>
          )}
          <div className="mt-1 text-sm text-ink-soft">ログインが必要なときは、ご自分でIDとパスワードを入れてください。</div>
        </div>
      );
    case "manual":
      return <div className="rounded-lg border border-rule bg-paper p-3 text-lg">{r.note ?? "手入力（メモなし）"}</div>;
    case "fax_pdf":
      return (
        <a className="font-bold text-crust-700 underline" href={r.pdfUrl} target="_blank" rel="noreferrer">
          FAX（PDF）を開く
        </a>
      );
    case "google_sheet":
      return (
        <a className="font-bold text-crust-700 underline" href={r.url} target="_blank" rel="noreferrer">
          {r.sheetName} {r.range}
        </a>
      );
  }
}
