"use client";
import { getPdfjs, pdfDocOptions } from "@/lib/pdfjs";
import { useEffect, useRef, useState } from "react";

/**
 * 元のFAX(PDF)を表示する（担当者の指示 11/5：スクロールせずに全体が見えるように）。
 * - 2ページ以上は、2枚を横に並べ、枠の高さに合わせて縮小する（3枚以上は「次の2枚」で送る）。1ページは大きく1枚
 * - ページをタップすると、その1枚を大きく表示（＋−で拡大・スクロール可）。「2枚にもどす」で戻る
 * - rotation で向きを直し、highlight(0〜100%) の高さに帯を出す（帯は1ページ目）
 */
export function PdfView({ url, rotation, highlight }: { url: string; rotation: number; highlight?: number | null }) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [first, setFirst] = useState(1); // 並べて見ている左のページ
  const [focus, setFocus] = useState<number | null>(null); // 大きく見ているページ
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);

  // PDF を開く（URL が変わったときだけ）
  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | null = null;
    (async () => {
      try {
        const pdfjs = await getPdfjs();
        const loading = pdfjs.getDocument({ url, ...pdfDocOptions });
        destroy = () => void loading.destroy();
        const d = (await loading.promise) as unknown as PdfDoc;
        if (cancelled) return;
        setDoc(d);
        setFirst(1);
        setFocus(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      setDoc(null);
      destroy?.();
    };
  }, [url]);

  const pages = doc?.numPages ?? 0;
  const shown = pages >= 2 ? [first, first + 1].filter((p) => p <= pages) : pages === 1 ? [1] : [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-3 py-2 text-sm">
        <span className="font-bold">元のFAX</span>
        {pages > 1 && <span className="text-ink-soft">全{pages}枚</span>}
        {rotation !== 0 && <span className="pill bg-info-bg text-info-ink">{rotation}° 回転して表示中</span>}
        <span className="ml-auto" />
        {focus == null && pages > 2 && (
          <>
            <button className="btn-ghost px-2 py-1" disabled={first <= 1} onClick={() => setFirst((p) => Math.max(1, p - 2))}>◀ 前の2枚</button>
            <span>{first}〜{Math.min(first + 1, pages)}枚目</span>
            <button className="btn-ghost px-2 py-1" disabled={first + 1 >= pages} onClick={() => setFirst((p) => Math.min(pages - 1, p + 2))}>次の2枚 ▶</button>
          </>
        )}
        {focus != null && (
          <>
            <span className="font-bold">{pages > 1 ? `${focus}枚目を大きく表示中` : "大きく表示中"}</span>
            <button className="btn-ghost px-2 py-1" onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))}>－</button>
            <span className="w-12 text-center">{Math.round(zoom * 100)}%</span>
            <button className="btn-ghost px-2 py-1" onClick={() => setZoom((z) => Math.min(2.4, z + 0.2))}>＋</button>
            <button className="btn-ghost px-2 py-1" onClick={() => { setFocus(null); setZoom(1); }}>{pages > 1 ? "2枚にもどす" : "全体にもどす"}</button>
          </>
        )}
      </div>
      {error && <div className="p-3 text-alert-ink">表示できませんでした: {error}</div>}
      {focus == null ? (
        // 並べて見る: 枠の高さに合わせて縮小（スクロールしない）
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 overflow-hidden bg-off-bg p-2">
          {shown.map((p) => (
            <button
              key={`${p}-${rotation}`}
              type="button"
              title="タップで大きく表示"
              className="flex h-full min-h-0 min-w-0 flex-1 items-center justify-center"
              onClick={() => { setFocus(p); setZoom(1); }}
            >
              <PageCanvas doc={doc} page={p} rotation={rotation} fit highlight={p === 1 ? highlight : null} />
            </button>
          ))}
        </div>
      ) : (
        // 1枚を大きく: 幅に合わせて、＋−で拡大・スクロール
        <div className="relative min-h-0 flex-1 overflow-auto bg-off-bg p-3">
          <div className="relative mx-auto" style={{ width: `${zoom * 100}%` }}>
            <PageCanvas key={`${focus}-${rotation}`} doc={doc} page={focus} rotation={rotation} highlight={focus === 1 ? highlight : null} />
          </div>
        </div>
      )}
      {focus == null && pages > 0 && <div className="border-t border-rule px-3 py-1 text-xs text-ink-faint">ページをタップすると大きく見られます</div>}
    </div>
  );
}

type PdfPage = {
  rotate: number;
  getViewport: (o: { scale: number; rotation: number }) => { width: number; height: number };
  render: (o: { canvas: HTMLCanvasElement; viewport: unknown }) => { promise: Promise<void>; cancel: () => void };
};
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };

/** 1ページを描く。fit なら枠に収まるよう縦横とも縮小、そうでなければ幅いっぱい */
function PageCanvas({ doc, page, rotation, fit = false, highlight }: { doc: PdfDoc | null; page: number; rotation: number; fit?: boolean; highlight?: number | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    (async () => {
      const pg = await doc.getPage(page);
      const viewport = pg.getViewport({ scale: 2, rotation: (pg.rotate + rotation) % 360 });
      const canvas = ref.current;
      if (!canvas || cancelled) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      // 前の描画と重ならないように、1つずつ描く（重なると白黒FAXの画像が描かれないことがある）
      const t = pg.render({ canvas, viewport });
      task = t;
      await t.promise;
    })().catch((e) => {
      if (!(e instanceof Error && e.name === "RenderingCancelledException")) console.error("PdfView", e);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page, rotation]);
  return (
    <span className={`relative inline-block border border-rule-strong bg-sheet ${fit ? "max-h-full max-w-full" : "w-full"}`}>
      <canvas ref={ref} className={fit ? "block h-auto max-h-[calc(100vh-15rem)] w-auto max-w-full" : "block h-auto w-full"} />
      {highlight != null && (
        <span
          className="pointer-events-none absolute inset-x-0 h-[6%] -translate-y-1/2 rounded bg-review-line/30 ring-2 ring-review-line transition-all"
          style={{ top: `${highlight}%` }}
        />
      )}
    </span>
  );
}
