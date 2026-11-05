import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { nowMs } from "@/lib/clock";
import { safeNext, STAFF_COOKIE, verifyStaffSession } from "@/lib/auth/staff-session";
import { StaffLogin } from "./StaffLogin";

// スタッフの「LINE でログイン」の入口（④）。お知らせの LINE のリンクはここを通る（/liff/staff?to=/purchase など）。
// すでに有効な cookie があれば、そのまま行き先へ。無ければ LIFF で LINE の本人確認をする。
export const metadata = { title: "LINE でログイン" };

export default async function StaffLoginPage({ searchParams }: { searchParams: Promise<{ to?: string; next?: string }> }) {
  // 行き先は ?to=（通知のリンク）か ?next=（proxy.ts が送るとき）
  const sp = await searchParams;
  const next = safeNext(sp.to ?? sp.next);
  const jar = await cookies();
  if (verifyStaffSession(jar.get(STAFF_COOKIE)?.value, nowMs())) redirect(next);
  return <StaffLogin liffId={process.env.NEXT_PUBLIC_LIFF_STAFF_ID ?? ""} next={next} />;
}
