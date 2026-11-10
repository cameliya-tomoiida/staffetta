import type { Metadata, Viewport } from "next";

// お客さんがLINEの中で開く注文画面。工場側のメニュー（ヘッダー）は出さない。

export const metadata: Metadata = { title: "ご注文" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1 };

export default function LiffLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* 共通レイアウトのヘッダーと余白を、この画面だけ消す */}
      <style>{`body > header { display: none !important; } body > main { max-width: none !important; padding: 0 !important; }`}</style>
      {children}
    </>
  );
}
