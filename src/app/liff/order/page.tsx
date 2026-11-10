import { headers } from "next/headers";
import { allProducts } from "@/lib/catalog";
import { LiffOrder } from "./LiffOrder";
import { fromOutside } from "@/lib/tunnel-access";

// LIFFの注文フォーム。LINE公式アカウントのリッチメニュー「ご注文」から開く。
// デモ（動画・社内PC）: http://localhost:3100/liff/order?demoUser=U_demo_kotori
//   ・localhost から開いたときだけ demoUser が効く（トンネル経由＝お客さんのLINEからは必ずLINEの本人確認）
//   ・審査員向けの見本（HUB_DEMO=1・Render）は外からでも、架空のお客さん（U_demo_…）で開く。既定は U_demo_kotori（11/8 管理役2）

export default async function LiffPage({ searchParams }: { searchParams: Promise<{ demoUser?: string }> }) {
  const { demoUser } = await searchParams;
  const h = await headers();
  const local = !fromOutside(h) && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h.get("host") ?? "");
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID ?? "";
  const publicDemo = process.env.HUB_DEMO === "1";
  const demo = publicDemo || (local && (Boolean(demoUser) || !liffId));
  const demoId = demoUser?.startsWith("U_demo_") ? demoUser : "U_demo_kotori";
  return (
    <LiffOrder
      liffId={demo ? "" : liffId}
      demoUserId={demo ? demoId : undefined}
      catalog={allProducts().map((p) => ({ id: p.id, name: p.name, unit: p.unit }))}
    />
  );
}
