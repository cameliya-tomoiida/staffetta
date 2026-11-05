import { cookies } from "next/headers";
import { connection } from "next/server";
import { STAFF_COOKIE, verifyStaffSession } from "@/lib/auth/staff-session";
import { loadMasters } from "@/lib/masters/seed-db";
import { todayJst } from "@/lib/clock";
import { DriverClient, type DriverCourse } from "./DriverClient";

export const metadata = { title: "配送｜STAFFETTA" };

/** ログインしているスタッフ（LINE ログインの cookie）。社内の LAN から開いたときは無い */
const staffOf = (cookie: string | undefined) => verifyStaffSession(cookie, Date.now());

// 配送スタッフのスマホ画面（作者の決定 11/5 夜）: 配達の途中・お客さんの前で受けた注文を、その場で入れる。
// 外から開けるのは、スタッフの LINE ログインをした人だけ（proxy.ts）。社内の LAN からはそのまま開ける。
export default async function DriverPage() {
  await connection();
  const [masters, jar] = await Promise.all([loadMasters(), cookies()]);
  const session = staffOf(jar.get(STAFF_COOKIE)?.value);
  const today = todayJst();
  const time = (t?: string) => t || "08:00";
  const rank = (order: string[] | undefined, id: string) => {
    const i = order?.indexOf(id) ?? -1;
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const courses: DriverCourse[] = masters.courses
    .filter((c) => c.active)
    .map((c) => ({
      id: c.id,
      name: c.name,
      departTime: c.departTime,
      weekdays: c.weekdays ?? [],
      stops: masters.customers
        .filter((cu) => cu.course === c.id)
        // 回る順番（⑦の便のマスタ stops）があればその順。無い先は後ろに、納品時刻の順で
        .sort((a, b) => rank(c.stops, a.id) - rank(c.stops, b.id) || time(a.deliveryTime).localeCompare(time(b.deliveryTime)))
        .map((cu) => ({ customerId: cu.id, name: cu.name, deliveryTime: time(cu.deliveryTime), weekdays: cu.deliveryWeekdays ?? [] })),
    }))
    .filter((c) => c.stops.length > 0);
  const customers = masters.customers.map((c) => ({ id: c.id, name: c.name, course: c.course ?? "" }));
  return <DriverClient courses={courses} customers={customers} today={today} staffName={session?.n ?? ""} />;
}
