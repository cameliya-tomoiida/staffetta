import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
