import { cookies } from "next/headers";
import { connection } from "next/server";
import { STAFF_COOKIE, verifyStaffSession } from "@/lib/auth/staff-session";
import { loadMasters } from "@/lib/masters/seed-db";
import { todayJst } from "@/lib/clock";
import { findStaffByName, listStaff } from "@/lib/staff";
import { getDepot } from "@/lib/routes/store";
import { DriverClient } from "./DriverClient";

export const metadata = { title: "配送｜STAFFETTA" };

/** ログインしているスタッフ（LINE ログインの cookie）。社内の LAN から開いたときは無い */
const staffOf = (cookie: string | undefined) => verifyStaffSession(cookie, Date.now());

// 配送スタッフのスマホ画面（作者 11/6 0:50「休んだ人の代わり・新しい人でも、このアプリだけで配送の仕事が分かるように」）。
// 主役は「配送」タブ（その日のコースの地図・順番・各先に渡すもの・納品の仕方）。注文を受けるのは、その途中の一部。
// 外から開けるのは、スタッフの LINE ログインをした人だけ（proxy.ts）。社内の LAN からはそのまま開ける。
export default async function DriverPage() {
  await connection();
  const [masters, jar] = await Promise.all([loadMasters(), cookies()]);
  const session = staffOf(jar.get(STAFF_COOKIE)?.value);
  const me = findStaffByName(session?.n);
  const courses = masters.courses.filter((c) => c.active && masters.customers.some((cu) => cu.course === c.id && cu.active !== false));
  const customers = masters.customers.filter((c) => c.active !== false).map((c) => ({ id: c.id, name: c.name, course: c.course ?? "", address: c.address ?? "" }));
  return (
    <DriverClient
      courses={courses.map((c) => ({ id: c.id, name: c.name, departTime: c.departTime }))}
      myCourses={me?.courses ?? []}
      customers={customers}
      today={todayJst()}
      staffName={session?.n ?? ""}
      staffNames={listStaff().map((s) => s.name)}
      depot={(({ lat, lng, name }) => ({ lat, lng, name }))(getDepot())}
    />
  );
}
