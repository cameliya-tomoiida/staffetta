"use client";
import { getPdfjs, pdfDocOptions } from "@/lib/pdfjs";
import { useEffect, useRef, useState } from "react";

/** 元のFAX(PDF)を表示する。rotation で向きを直し、highlight(0〜100%) の高さに帯を出す */
export function PdfView({ url, rotation, highlight }: { url: string; rotation: number; highlight?: number | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    let destroy: (() => void) | null = null;
    (async () => {
      try {
        const pdfjs = await getPdfjs();
        const loading = pdfjs.getDocument({ url, ...pdfDocOptions });
        destroy = () => void loading.destroy();
        const doc = await loading.promise;
        const page = await doc.getPage(1);
        const viewport = page.getViewport({ scale: 2, rotation: (page.rotate + rotation) % 360 });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        // 前の描画と重ならないように、1つずつ描く（重なると白黒FAXの画像が描かれないことがある）
        const t = page.render({ canvas, viewport });
        task = t;
        await t.promise;
      } catch (e) {
        if (cancelled || (e instanceof Error && e.name === "RenderingCancelledException")) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
      destroy?.();
    };
  }, [url, rotation]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-rule px-3 py-2 text-sm">
        <span className="font-bold">元のFAX</span>
        {rotation !== 0 && <span className="pill bg-info-bg text-info-ink">{rotation}° 回転して表示中</span>}
        <span className="ml-auto" />
        <button className="btn-ghost px-2 py-1" onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))}>－</button>
        <span className="w-12 text-center">{Math.round(zoom * 100)}%</span>
        <button className="btn-ghost px-2 py-1" onClick={() => setZoom((z) => Math.min(2.4, z + 0.2))}>＋</button>
      </div>
      <div className="relative flex-1 overflow-auto bg-off-bg p-3">
        {error && <div className="text-alert-ink">表示できませんでした: {error}</div>}
        <div className="relative mx-auto border border-rule-strong bg-sheet" style={{ width: `${zoom * 100}%` }}>
          <canvas ref={canvasRef} className="block h-auto w-full" />
          {highlight != null && (
            <div
              className="pointer-events-none absolute inset-x-0 h-[6%] -translate-y-1/2 rounded bg-review-line/30 ring-2 ring-review-line transition-all"
              style={{ top: `${highlight}%` }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
