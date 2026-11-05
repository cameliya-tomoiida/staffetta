import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 3100 を動かしたままビルドするときは、別の出力先（HUB_DIST_DIR=.next-stage）に作り、止めてから .next と入れ替える（ビルド中に 500 を返さないため。docs/prod-3100.md）
  distDir: process.env.HUB_DIST_DIR || ".next",
  // トンネル（Cloudflare）経由の開発サーバーで、LIFF の画面が JS を読めるように（担当者承認 11/4）
  allowedDevOrigins: ["*.trycloudflare.com"],
  // ⑤外部サイト: PDF作成(pdfkit)はフォントなどのファイルを自分の場所から読むので、まとめずにそのまま使う
  serverExternalPackages: ["pdfkit", "exceljs", "mailparser"],
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
