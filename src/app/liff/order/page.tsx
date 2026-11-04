import { headers } from "next/headers";
import { products } from "@/data/master";
import { LiffOrder } from "./LiffOrder";

// LIFFの注文フォーム。LINE公式アカウントのリッチメニュー「ご注文」から開く。
// デモ（動画・社内PC）: http://localhost:3100/liff/order?demoUser=U_demo_kotori
//   ・localhost から開いたときだけ demoUser が効く（トンネル経由＝お客さんのLINEからは必ずLINEの本人確認）

export default async function LiffPage({ searchParams }: { searchParams: Promise<{ demoUser?: string }> }) {
  const { demoUser } = await searchParams;
  const h = await headers();
  const local = !h.has("cf-ray") && !h.has("cf-connecting-ip") && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h.get("host") ?? "");
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID ?? "";
  const demo = local && (Boolean(demoUser) || !liffId);
  return (
    <LiffOrder
      liffId={demo ? "" : liffId}
      demoUserId={demo ? demoUser || "U_demo_kotori" : undefined}
      catalog={products.map((p) => ({ id: p.id, name: p.name, unit: p.unit }))}
    />
  );
}
