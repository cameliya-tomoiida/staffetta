import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 3100 を動かしたままビルドするときは、別の出力先（HUB_DIST_DIR=.next-stage）に作り、止めてから .next と入れ替える（ビルド中に 500 を返さないため。docs/prod-3100.md）
  distDir: process.env.HUB_DIST_DIR || ".next",
  // トンネル（Cloudflare）経由の開発サーバーで、LIFF の画面が JS を読めるように（作者承認 11/4）
  allowedDevOrigins: ["*.trycloudflare.com"],
  // ⑤外部サイト: PDF作成(pdfkit)はフォントなどのファイルを自分の場所から読むので、まとめずにそのまま使う
  serverExternalPackages: ["pdfkit", "exceljs", "mailparser"],
  experimental: {
    // 設定 → バックアップの「戻す」はファイル全体（FAX の PDF 入り）を Server Action で送る。既定の 1MB では 500 になる（管理役2 11/7）
    serverActions: { bodySizeLimit: "100mb" },
    // proxy.ts があると、送る中身は既定で 10MB まで。戻すファイルに合わせる
    proxyClientMaxBodySize: "100mb",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
