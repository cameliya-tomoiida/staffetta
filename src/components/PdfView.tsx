"use client";
import { openPdf } from "@/lib/pdfjs";
import { useEffect, useRef, useState } from "react";

/**
 * 元のFAX(PDF)を表示する（作者の指示 11/5：スクロールせずに全体が見えるように。11/5 夜：Codex のデザイン案で作り直し）。
 * - 2ページ以上は、2枚を並べて枠に合わせて縮小する。縦長のページは横に2枚、横長のページは縦に2枚（1枚を横いっぱい）。
 *   3枚以上は「次」で送る。1ページは大きく1枚
 * - ＋／−・ピンチで拡大（1枚を大きく表示してスクロール）。「全体を表示」で戻る。「大きく見る」で画面いっぱいに広げる
 * - rotation で向きを直し、highlight(0〜100%) の高さに帯を出す（帯は1ページ目）
 * - 大きく表示しているとき、ページに触れると onPick(ページ, 高さ%) を知らせる（右の表の同じ行を光らせる）
 */
export function PdfView({ url, rotation, highlight, onPick, onRotate }: {
  url: string;
  rotation: number;
  highlight?: number | null;
  onPick?: (page: number, yPercent: number) => void;
  /** 向きを直すボタンを出すとき（確定前だけ） */
  onRotate?: (deg: 90 | 270) => void;
}) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [first, setFirst] = useState(1); // 並べて見ている左のページ
  const [focus, setFocus] = useState<number | null>(null); // 大きく見ているページ
  const [zoom, setZoom] = useState(1);
  const [full, setFull] = useState(false); // 画面いっぱいに広げている
  const [error, setError] = useState<string | null>(null);

  // PDF を開く（URL が変わったときだけ）
  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | null = null;
    (async () => {
      try {
        const loading = await openPdf(url); // ワーカーは使い回し（閉じてもワーカーは壊れない）
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

  // 画面いっぱいのときは Esc で戻る
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  // ページが横長（幅 > 高さ）なら、2枚は縦に積む（1枚を横いっぱい）。縦長なら横に並べる
  const [landscape, setLandscape] = useState(false);
  const pages = doc?.numPages ?? 0;
  const shown = pages >= 2 ? [first, first + 1].filter((p) => p <= pages) : pages === 1 ? [1] : [];
  const clamp = (z: number) => Math.round(Math.min(4, Math.max(0.5, z)) * 100) / 100;
  const zoomBy = (d: number) => {
    if (focus == null) {
      setFocus(first);
      setZoom(clamp(1 + Math.max(0, d)));
    } else setZoom((z) => clamp(z + d));
  };
  const overview = () => {
    setFocus(null);
    setZoom(1);
  };

  // ピンチで拡大・縮小（2本の指の間の長さの変化）
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchFrom = useRef<{ dist: number; zoom: number } | null>(null);
  const dist = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) pinchFrom.current = { dist: dist(), zoom };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const from = pinchFrom.current;
    if (from && pointers.current.size === 2 && from.dist > 0) setZoom(clamp(from.zoom * (dist() / from.dist)));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchFrom.current = null;
  };

  const btn = "inline-flex min-h-12 items-center justify-center rounded-lg border-2 border-rule-strong bg-sheet px-3 text-[18px] font-bold hover:border-crust-500 disabled:opacity-40 lg:min-h-9 lg:px-2 lg:text-[16px]";

  return (
    <div className={full ? "fixed inset-0 z-50 flex flex-col bg-sheet" : "flex h-full flex-col"}>
      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-3 py-2 lg:gap-1.5 lg:py-1">
        <button type="button" className={`${btn} w-12`} aria-label="小さくする" onClick={() => zoomBy(-0.25)} disabled={focus == null}>−</button>
        <span className="w-16 text-center text-[18px] font-bold tabular-nums">{Math.round((focus == null ? 1 : zoom) * 100)}%</span>
        <button type="button" className={`${btn} w-12`} aria-label="大きくする" onClick={() => zoomBy(0.25)}>＋</button>
        <button type="button" className={btn} onClick={overview} disabled={focus == null}>全体を表示</button>
        <button type="button" className={btn} onClick={() => setFull((v) => !v)}>{full ? "もとに戻す" : "大きく見る"}</button>
        {onRotate && (
          <>
            <button type="button" className={btn} aria-label="左に回す" title="向きがおかしいときは回す" onClick={() => onRotate(270)}>↺</button>
            <button type="button" className={btn} aria-label="右に回す" title="向きがおかしいときは回す" onClick={() => onRotate(90)}>↻</button>
          </>
        )}
        <span className="ml-auto" />
        {rotation !== 0 && <span className="pill bg-info-bg text-info-ink">{rotation}° 回転</span>}
        {focus == null && pages > 2 && (
          <>
            <button type="button" className={btn} disabled={first <= 1} onClick={() => setFirst((p) => Math.max(1, p - 2))}>◀ 前</button>
            <span className="text-[16px] tabular-nums">{first}〜{Math.min(first + 1, pages)} / {pages}枚</span>
            <button type="button" className={btn} disabled={first + 1 >= pages} onClick={() => setFirst((p) => Math.min(pages - 1, p + 2))}>次 ▶</button>
          </>
        )}
        {focus == null && pages === 2 && <span className="text-[16px]">全2枚</span>}
        {focus != null && pages > 1 && (
          <>
            <button type="button" className={btn} disabled={focus <= 1} onClick={() => setFocus((p) => Math.max(1, (p ?? 1) - 1))}>◀ 前</button>
            <span className="text-[16px] tabular-nums">{focus} / {pages}枚</span>
            <button type="button" className={btn} disabled={focus >= pages} onClick={() => setFocus((p) => Math.min(pages, (p ?? 1) + 1))}>次 ▶</button>
          </>
        )}
      </div>
      {error && <div className="p-3 text-alert-ink">表示できませんでした: {error}</div>}
      {focus == null ? (
        // 並べて見る: 枠の高さに合わせて縮小（スクロールしない）
        <div className={`flex min-h-0 flex-1 items-center justify-center gap-2 overflow-hidden bg-off-bg p-2 ${landscape && shown.length > 1 ? "flex-col" : ""}`}>
          {shown.map((p) => (
            <button
              key={`${p}-${rotation}`}
              type="button"
              title="タップで大きく表示"
              className={`flex min-h-0 min-w-0 flex-1 items-center justify-center ${landscape && shown.length > 1 ? "w-full" : "h-full"}`}
              onClick={() => {
                setFocus(p);
                setZoom(1.25);
              }}
            >
              <PageCanvas doc={doc} page={p} rotation={rotation} fit full={full} stacked={landscape && shown.length > 1} highlight={p === 1 ? highlight : null} onSize={p === shown[0] ? (w, h) => setLandscape(w > h) : undefined} />
            </button>
          ))}
        </div>
      ) : (
        // 1枚を大きく: 幅に合わせて、＋−・ピンチで拡大・スクロール。触れた高さを右の表に知らせる
        <div
          className="relative min-h-0 flex-1 overflow-auto bg-off-bg p-3"
          style={{ touchAction: "pan-x pan-y" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <div
            className="relative mx-auto"
            style={{ width: `${zoom * 100}%` }}
            onClick={(e) => {
              if (!onPick) return;
              const box = e.currentTarget.getBoundingClientRect();
              onPick(focus, ((e.clientY - box.top) / box.height) * 100);
            }}
          >
            <PageCanvas key={`${focus}-${rotation}`} doc={doc} page={focus} rotation={rotation} highlight={focus === 1 ? highlight : null} />
          </div>
        </div>
      )}
      <div className="border-t border-rule px-3 py-1.5 text-[16px] text-ink-soft">
        {focus == null ? "ページに触れると大きく見られます。＋・ピンチでも拡大できます" : "FAX の行に触れると、右の表の同じ行が光ります"}
      </div>
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
function PageCanvas({ doc, page, rotation, fit = false, full = false, stacked = false, highlight, onSize }: {
  doc: PdfDoc | null; page: number; rotation: number; fit?: boolean; full?: boolean; stacked?: boolean; highlight?: number | null;
  /** 描いたページの大きさ（向きを直したあと）を知らせる。横長かどうかの判断に使う */
  onSize?: (w: number, h: number) => void;
}) {
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
      onSize?.(viewport.width, viewport.height);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onSize は親が毎回作り直すので、描き直しの条件に入れない
  }, [doc, page, rotation]);
  return (
    <span className={`relative inline-block border border-rule-strong bg-sheet ${fit ? "max-h-full max-w-full" : "w-full"}`}>
      <canvas
        ref={ref}
        className={
          !fit
            ? "block h-auto w-full"
            : stacked
              ? `block h-auto w-auto max-w-full ${full ? "max-h-[calc((100vh-9rem)/2)]" : "max-h-[calc((100vh-16rem)/2)]"}` // 縦に2枚: 1枚は高さの半分まで、幅いっぱい
              : `block h-auto w-auto max-w-full ${full ? "max-h-[calc(100vh-8rem)]" : "max-h-[calc(100vh-15rem)]"}`
        }
      />
      {highlight != null && (
        <span
          className="pointer-events-none absolute inset-x-0 h-[6%] -translate-y-1/2 rounded bg-review-line/30 ring-2 ring-review-line transition-all"
          style={{ top: `${highlight}%` }}
        />
      )}
    </span>
  );
}
