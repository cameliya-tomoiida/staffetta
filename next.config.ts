import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
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
