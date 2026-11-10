// 見本の配送コースに、架空の届け先を足して 6〜8軒にする（11/8 担当者「見本の地図が1コース1軒しかない」）。
// ルート表は「その日に注文がある先」だけを並べるので、便が走る日（今日・明日など）の小さな注文も足す。見本の DB だけに書く。
import { upsertMasters } from "@/lib/db/masters";
import { loadForUpdate } from "@/lib/db/hub-store";
import { loadMasters } from "@/lib/masters/seed-db";
import { getDepot } from "@/lib/routes/store";
import { deliversOn } from "@/lib/routes/optimize";
import type { Order } from "@/data/types";

const NAMES = ["みどり", "ひかり", "さくら", "あおば", "つばさ", "こもれび", "ひまわり", "わかば"];
const KINDS = ["保育園", "こども園", "病院", "介護施設", "社員食堂", "喫茶", "給食センター", "売店"];
const PRODUCTS = ["P01", "P05", "P02"];

export async function fillDemoCourses(dates: string[]): Promise<string> {
  const m = await loadMasters();
  const depot = getDepot();
  const courses = (m.customers ? m.courses ?? [] : []).filter((c) => c.active !== false);
  const all = (m.customers ?? []).filter((c) => c.active !== false);
  let seed = 11;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const newCustomers: Record<string, unknown>[] = [];
  const changedCourses: Record<string, unknown>[] = [];
  courses.forEach((course, ci) => {
    const mine = all.filter((c) => c.course === course.id);
    const target = 6 + (ci % 3); // 6〜8軒
    if (mine.length >= target) return;
    const pts = mine.filter((c) => c.lat != null && c.lng != null);
    // 置く所: そのコースの先の真ん中（無ければ、工場から少し離れた所をコースごとにずらす）
    const center = pts.length
      ? { lat: pts.reduce((a, c) => a + c.lat!, 0) / pts.length, lng: pts.reduce((a, c) => a + c.lng!, 0) / pts.length }
      : { lat: depot.lat + 0.05 * Math.cos(ci), lng: depot.lng + 0.06 * Math.sin(ci) };
    const ids: string[] = [];
    for (let k = mine.length; k < target; k++) {
      const id = `CX${String(ci + 1).padStart(2, "0")}${String(k + 1).padStart(2, "0")}`;
      ids.push(id);
      newCustomers.push({
        id,
        name: `${NAMES[(ci + k) % NAMES.length]}${KINDS[(ci * 3 + k) % KINDS.length]}（見本）`,
        channel: "fax", cutoff: "15:00", course: course.id,
        deliveryWeekdays: course.weekdays?.length ? course.weekdays : [1, 2, 3, 4, 5, 6],
        address: `愛知県名古屋市（見本）${course.name} ${k + 1}`,
        lat: Math.round((center.lat + (rnd() - 0.5) * 0.05) * 1e6) / 1e6,
        lng: Math.round((center.lng + (rnd() - 0.5) * 0.06) * 1e6) / 1e6,
        deliveryMethod: "own",
        deliveryWindowFrom: ["06:00", "06:30", "07:00"][k % 3], deliveryWindowTo: ["11:00", "11:30", "12:00"][k % 3],
        active: true,
      });
    }
    changedCourses.push({ ...course, stops: [...(course.stops ?? mine.map((c) => c.id)), ...ids] });
  });
  if (newCustomers.length) await upsertMasters("customers", newCustomers as never[], "見本のコース");
  if (changedCourses.length) await upsertMasters("courses", changedCourses as never[], "見本のコース");

  // 便が走る日に、コースの先それぞれに小さな注文（もう注文がある先は足さない）
  const after = await loadMasters();
  const everyone = (after.customers ?? []).filter((c) => c.active !== false && c.course && (c.deliveryMethod ?? "own") === "own");
  const { db, save } = await loadForUpdate();
  let added = 0;
  for (const date of dates) {
    const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
    for (const c of everyone) {
      const course = (after.courses ?? []).find((x) => x.id === c.course);
      if (!course || (course.weekdays?.length && !course.weekdays.includes(wd)) || !deliversOn(c, wd)) continue;
      if (db.orders.some((o) => o.customerId === c.id && o.deliveryDate === date && o.status !== "cancelled")) continue;
      const pid = PRODUCTS[(c.id.length + added) % PRODUCTS.length];
      const qty = 10 + ((added * 7) % 30);
      const at = new Date(Date.parse(`${date}T00:00:00+09:00`) - 9 * 3600_000).toISOString();
      const o: Order = {
        id: `SCX-${date}-${c.id}`, customerId: c.id, deliveryDate: date, status: "confirmed", intent: "new", createdAt: at, edits: [],
        source: { channel: "fax", refs: [], receivedAt: at },
        lines: [{ id: `SCX-${date}-${c.id}-1`, productId: pid, quantity: qty, unit: "個", piecesPerUnit: 1, pieces: qty, confidence: 1, edits: [] }],
      };
      db.orders.push(o);
      added++;
    }
  }
  await save();
  return `見本のコースに届け先を ${newCustomers.length}軒・注文を ${added}件 足しました`;
}
