"use client";
// pdf.js をブラウザで使うための共通の準備（ワーカーは1つだけ作って使い回す）
let loading: Promise<typeof import("pdfjs-dist")> | null = null;

export function getPdfjs() {
  loading ??= import("pdfjs-dist").then((pdfjs) => {
    if (!pdfjs.GlobalWorkerOptions.workerPort) {
      pdfjs.GlobalWorkerOptions.workerPort = new Worker("/pdf.worker.min.mjs", { type: "module" });
    }
    return pdfjs;
  });
  return loading;
}
