"use client";
import { getPdfjs, pdfDocOptions } from "@/lib/pdfjs";
import { useEffect, useRef } from "react";

/** 受信箱のサムネイル（1ページ目を小さく描く） */
export function PdfThumb({ url, rotation = 0 }: { url: string; rotation?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pdfjs = await getPdfjs();
      const doc = await pdfjs.getDocument({ url, ...pdfDocOptions }).promise;
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: 0.6, rotation: (page.rotate + rotation) % 360 });
      const canvas = ref.current;
      if (!canvas || cancelled) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvas, viewport }).promise;
    })().catch((e) => console.error("PdfThumb", e));
    return () => {
      cancelled = true;
    };
  }, [url, rotation]);
  return <canvas ref={ref} className="block w-full" />;
}
