import { products } from "@/data/master";
import { LiffOrder } from "./LiffOrder";

// LIFFの注文フォーム。LINE公式アカウントのリッチメニュー「注文する」から開く。
// LINEが未設定のときは http://localhost:3103/liff?demoUser=U_demo_kotori でデモできる。

export default async function LiffPage({ searchParams }: { searchParams: Promise<{ demoUser?: string }> }) {
  const { demoUser } = await searchParams;
  return (
    <LiffOrder
      liffId={process.env.NEXT_PUBLIC_LIFF_ID ?? ""}
      demoUserId={process.env.LINE_LOGIN_CHANNEL_ID ? undefined : demoUser || "U_demo_kotori"}
      catalog={products.map((p) => ({ id: p.id, name: p.name, unit: p.unit }))}
    />
  );
}
