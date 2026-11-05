"use client";
import { getPdfjs, pdfDocOptions } from "@/lib/pdfjs";
import { useEffect, useRef, useState } from "react";

/** 受信箱のサムネイル。2ページ以上の FAX は、1・2ページ目を2枚並べる（縦長は横に、横長は縦に。担当者の指示 11/5） */
export function PdfThumb({ url, rotation = 0 }: { url: string; rotation?: number }) {
  const ref1 = useRef<HTMLCanvasElement>(null);
  const ref2 = useRef<HTMLCanvasElement>(null);
  const [count, setCount] = useState(1);
  const [landscape, setLandscape] = useState(false); // 横長のページは縦に2枚
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pdfjs = await getPdfjs();
      const doc = await pdfjs.getDocument({ url, ...pdfDocOptions }).promise;
      const n = Math.min(2, doc.numPages);
      if (cancelled) return;
      setCount(n);
      // 2枚目の canvas が画面に出るのを待ってから描く
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      for (let p = 1; p <= n; p++) {
        const page = await doc.getPage(p);
        const viewport = page.getViewport({ scale: 0.6, rotation: (page.rotate + rotation) % 360 });
        const canvas = (p === 1 ? ref1 : ref2).current;
        if (!canvas || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        if (p === 1) setLandscape(viewport.width > viewport.height);
        await page.render({ canvas, viewport }).promise;
      }
    })().catch((e) => console.error("PdfThumb", e));
    return () => {
      cancelled = true;
    };
  }, [url, rotation]);
  return (
    <div className={`flex h-full gap-1 ${landscape && count > 1 ? "flex-col" : "items-start"}`}>
      <canvas ref={ref1} className={count > 1 && !landscape ? "block w-1/2 min-w-0" : "block w-full"} />
      {count > 1 && <canvas ref={ref2} className={landscape ? "block w-full" : "block w-1/2 min-w-0"} />}
    </div>
  );
}
