"use client";
import { useEffect, useRef, useState } from "react";

/** 元のFAX(PDF)を表示する。rotation で向きを直し、highlight(0〜100%) の高さに帯を出す */
export function PdfView({ url, rotation, highlight }: { url: string; rotation: number; highlight?: number | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const doc = await pdfjs.getDocument({ url }).promise;
        const page = await doc.getPage(1);
        const viewport = page.getViewport({ scale: 2, rotation: (page.rotate + rotation) % 360 });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, viewport }).promise;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, rotation]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-black/5 px-3 py-2 text-sm">
        <span className="font-bold">元のFAX</span>
        {rotation !== 0 && <span className="pill bg-blue-100 text-blue-800">{rotation}° 回転して表示中</span>}
        <span className="ml-auto" />
        <button className="btn-ghost px-2 py-1" onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))}>－</button>
        <span className="w-12 text-center">{Math.round(zoom * 100)}%</span>
        <button className="btn-ghost px-2 py-1" onClick={() => setZoom((z) => Math.min(2.4, z + 0.2))}>＋</button>
      </div>
      <div className="relative flex-1 overflow-auto bg-gray-200 p-3">
        {error && <div className="text-red-700">表示できませんでした: {error}</div>}
        <div className="relative mx-auto bg-white shadow" style={{ width: `${zoom * 100}%` }}>
          <canvas ref={canvasRef} className="block h-auto w-full" />
          {highlight != null && (
            <div
              className="pointer-events-none absolute inset-x-0 h-[6%] -translate-y-1/2 rounded bg-amber-300/40 ring-2 ring-amber-500 transition-all"
              style={{ top: `${highlight}%` }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
