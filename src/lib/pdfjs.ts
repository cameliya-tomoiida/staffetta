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

/**
 * PDF を開く（受信箱のサムネイル・確認画面の共通）。ワーカーは1つを全部で使い回す。
 * getDocument にワーカーを渡さないと、pdf.js は共有のワーカーを借りて、その PDF を閉じる（destroy）ときにワーカーごと壊す。
 * すると、ほかのサムネイルが「PDFWorker.create - the worker is being destroyed」で描けなくなる（11/5 に⑤が見つけた）。
 * ワーカーを明示して渡すと、PDF を閉じてもワーカーは残る。
 */
let shared: Promise<InstanceType<(typeof import("pdfjs-dist"))["PDFWorker"]>> | null = null;
export async function openPdf(url: string) {
  const pdfjs = await getPdfjs();
  shared ??= Promise.resolve(pdfjs.PDFWorker.create({ port: pdfjs.GlobalWorkerOptions.workerPort ?? undefined }));
  const worker = await shared;
  return pdfjs.getDocument({ url, ...pdfDocOptions, worker });
}
