import { connection } from "next/server";
import { currentUser } from "@/lib/auth/current-user";
import { loadMasters } from "@/lib/masters/seed-db";
import { todayJst } from "@/lib/clock";
import { findStaffById, listStaff } from "@/lib/staff";
import { getDepot } from "@/lib/routes/store";
import { DriverClient } from "./DriverClient";

export const metadata = { title: "配送｜STAFFETTA" };

// 配送スタッフのスマホ画面（作者 11/6 0:50「休んだ人の代わり・新しい人でも、このアプリだけで配送の仕事が分かるように」）。
// 主役は「配送」タブ（その日のコースの地図・順番・各先に渡すもの・納品の仕方）。注文を受けるのは、その途中の一部。
// 外から開けるのは、スタッフの LINE ログインをした人だけ（proxy.ts）。社内の LAN からはそのまま開ける。
export default async function DriverPage() {
  await connection();
  // ログインしている人（パスワードか、スタッフの LINE ログイン）。社内の LAN からログインなしで開いたときは無い
  const [masters, user] = await Promise.all([loadMasters(), currentUser()]);
  const me = findStaffById(user?.id);
  const courses = masters.courses.filter((c) => c.active && masters.customers.some((cu) => cu.course === c.id && cu.active !== false));
  const customers = masters.customers.filter((c) => c.active !== false).map((c) => ({ id: c.id, name: c.name, course: c.course ?? "", address: c.address ?? "" }));
  return (
    <DriverClient
      courses={courses.map((c) => ({ id: c.id, name: c.name, departTime: c.departTime, weekdays: c.weekdays ?? [] }))}
      myCourses={me?.courses ?? []}
      customers={customers}
      today={todayJst()}
      staffName={user?.name ?? ""}
      // 左上のロゴでホームへ戻れるのは、配送の人以外（管理者・事務など。ログインなしの社内 LAN も）。担当者 11/8
      homeHref={user?.role === "配送" ? undefined : "/home"}
      staffNames={listStaff().map((s) => s.name)}
      depot={(({ lat, lng, name }) => ({ lat, lng, name }))(getDepot())}
    />
  );
}
