import { hasRouteAi } from "@/lib/routes/ai-chat";
import { listRouteRules } from "@/lib/routes/ai-store";
import { loadRouteData } from "@/lib/routes/store";
import { RoutesClient, type RouteCustomer } from "./RoutesClient";

export const metadata = { title: "配送コースの地図" };
export const dynamic = "force-dynamic";

// 配送コースの地図（⑦・管理者用）。コースごとに回る順を地図に並べ、到着の予定・帰社の予定を出す。
// 順番の並べ替え・おすすめの順番・コースを足す・昔のコース表の取り込み。配送スタッフの「納品した」は作らない。
export default async function RoutesPage(props: PageProps<"/admin/routes">) {
  const q = await props.searchParams;
  const yobi = Number(q.yobi);
  const { courses, customers, depot, settings } = await loadRouteData();
  const rows: RouteCustomer[] = customers.map((c) => ({
    id: c.id, name: c.name, address: c.address, lat: c.lat, lng: c.lng, course: c.course, deliveryMethod: c.deliveryMethod,
    deliveryWindowFrom: c.deliveryWindowFrom, deliveryWindowTo: c.deliveryWindowTo, deliveryHowTo: c.deliveryHowTo,
    deliveryCaution: c.deliveryCaution, closedWeekdays: c.closedWeekdays, deliveryTime: c.deliveryTime,
    deliveryWeekdays: c.deliveryWeekdays, serviceMinutes: c.serviceMinutes,
  }));
  return (
    <main className="space-y-6 p-6">
      <header>
        <h1 className="text-3xl font-bold">配送コースの地図</h1>
        <p className="mt-2 text-xl text-ink-soft">
          コースごとに、回る順番・着く時刻の目安・帰社の予定を見ます。順番を並べ替えると時刻をすぐ計算し直します。新しい人にコースを教えるときにも使えます。
        </p>
      </header>
      <RoutesClient courses={courses} customers={rows} depot={depot} settings={settings} optWeekday={Number.isInteger(yobi) && yobi >= 0 && yobi <= 6 ? yobi : undefined} optRun={q.mitoshi === "1"} rules={listRouteRules()} hasAi={hasRouteAi()} />
    </main>
  );
}
