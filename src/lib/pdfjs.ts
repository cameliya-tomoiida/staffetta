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

/**
 * getDocument に渡す共通の設定。
 * FAX の白黒2値（CCITT）の画像は pdf.js v6 では wasm で読み解くので、wasm の置き場所（public/pdfjs-wasm/）を教える。
 * これが無いと「Dependent image isn't ready yet」で真っ白になる。
 */
export const pdfDocOptions = { wasmUrl: "/pdfjs-wasm/" } as const;
