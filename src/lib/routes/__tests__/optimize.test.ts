// ⑦(17) コースの見直し（コース分け・順番・いちばん遅い出発・今との比べ）。架空の点だけ。
import { describe, expect, it } from "vitest";
import { currentRoutes, deliversOn, DEFAULT_OPTIMIZE, effectiveStop, optimizeRoutes, type OptimizeOptions, type OptStop } from "../optimize";
import { toHHMM, toMin } from "../plan";

const depot = { lat: 35.0, lng: 137.0 };
// 1 km ≒ 緯度 0.009 度・経度 0.011 度。速さ 60km/時・係数 1 で 1 km = 1 分
const at = (eastKm: number, northKm = 0) => ({ lat: 35.0 + northKm * 0.009, lng: 137.0 + eastKm * 0.011 });
const o = (x: Partial<OptimizeOptions> = {}): OptimizeOptions => ({ ...DEFAULT_OPTIMIZE, weekday: 1, settings: { roadFactor: 1, speedKmh: 60, trafficFactor: 1 }, ...x });
const s = (id: string, e: number, n = 0, x: Partial<OptStop> = {}): OptStop => ({ id, name: id, ...at(e, n), ...x });

describe("曜日と締め", () => {
  it("定休日・納品する曜日で、その日に回る先を決める", () => {
    expect(deliversOn({ closedWeekdays: [0] }, 0)).toBe(false);
    expect(deliversOn({ deliveryWeekdays: [2, 4] }, 1)).toBe(false);
    expect(deliversOn({ deliveryWeekdays: [2, 4] }, 2)).toBe(true);
    expect(deliversOn({}, 3)).toBe(true);
  });
  it("時間の希望が無く納品時刻だけの先は、納品時刻＋余裕を締めにする", () => {
    expect(effectiveStop({ id: "a", name: "a", deliveryTime: "05:00" }, 30).deliveryWindowTo).toBe("05:30");
    expect(effectiveStop({ id: "a", name: "a", deliveryTime: "05:00" }, -1).deliveryWindowTo).toBeUndefined();
    expect(effectiveStop({ id: "a", name: "a", deliveryTime: "05:00", deliveryWindowTo: "09:00" }, 30).deliveryWindowTo).toBe("09:00");
  });
});

describe("見直し案", () => {
  it("東と西に分かれた先は、2コースに分ける（どの先も遅れない）", () => {
    const stops = [s("E1", 10), s("E2", 12, 2), s("E3", 14), s("W1", -10), s("W2", -12, 2), s("W3", -14)].map((x) => ({ ...x, deliveryWindowTo: "07:00" }));
    const r = optimizeRoutes(depot, stops, o({ earliestDepart: "06:00" }));
    expect(r.unassigned).toEqual([]);
    expect(r.routes).toHaveLength(2);
    const groups = r.routes.map((x) => x.ids.map((id) => id[0]).join("")).sort();
    expect(groups).toEqual(["EEE", "WWW"]);
    expect(r.summary.late).toBe(0);
  });

  it("出発は、全部の先に間に合ういちばん遅い時刻（早く出すぎない）", () => {
    // 10 km 先に 8:00 まで → 約 10 分走るので 7:45 発（5分きざみで早めに丸める）
    const r = optimizeRoutes(depot, [s("A", 10, 0, { deliveryWindowTo: "08:00" })], o({ serviceMinutes: 10 }));
    expect(toHHMM(r.routes[0].depart)).toBe("07:45");
    expect(r.routes[0].timeline.lateCount).toBe(0);
  });

  it("時間の希望（から）より早く着くなら、待たないように遅く出る", () => {
    const r = optimizeRoutes(depot, [s("A", 10, 0, { deliveryWindowFrom: "09:00", deliveryWindowTo: "12:00" })], o());
    expect(r.routes[0].timeline.rows[0].wait).toBeLessThan(5);
  });

  it("コースの数を決めると、その数まで。入りきらない先は理由つきで出す", () => {
    // 東と西に 8:00 締め。1コースだと片方が間に合わない
    const stops = [s("E", 60, 0, { deliveryWindowTo: "08:00" }), s("W", -60, 0, { deliveryWindowTo: "08:00" })];
    const r = optimizeRoutes(depot, stops, o({ courses: 1, earliestDepart: "06:50" }));
    expect(r.routes).toHaveLength(1);
    expect(r.unassigned).toHaveLength(1);
    expect(r.unassigned[0].reason).toMatch(/1コース/);
  });

  it("いちばん早い出発でも間に合わない先は、はじめから外す", () => {
    const r = optimizeRoutes(depot, [s("far", 200, 0, { deliveryWindowTo: "04:30" })], o({ earliestDepart: "04:00" }));
    expect(r.routes).toHaveLength(0);
    expect(r.unassigned[0].reason).toMatch(/間に合いません/);
  });

  it("1件ごとの納品の時間が使われる", () => {
    const r = optimizeRoutes(depot, [s("A", 10, 0, { serviceMinutes: 40, deliveryWindowTo: "12:00" })], o());
    const row = r.routes[0].timeline.rows[0];
    expect(row.leave - row.start).toBe(40);
  });

  it("150 件でも数秒で出る", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const stops = Array.from({ length: 150 }, (_, i) => s(`S${i}`, (rnd() - 0.5) * 50, (rnd() - 0.5) * 50, { deliveryTime: toHHMM(toMin("06:00") + Math.floor(rnd() * 240)) }));
    const t0 = Date.now();
    const r = optimizeRoutes(depot, stops, o({ maxHours: 6 }));
    expect(Date.now() - t0).toBeLessThan(15000);
    expect(r.summary.stops + r.unassigned.length).toBe(150);
    expect(r.summary.late).toBe(0);
  }, 30000);
});

describe("今のコースと比べる", () => {
  it("その曜日に走る便だけ。保存してある順で、間に合ういちばん遅い出発も出す", () => {
    const customers: OptStop[] = [s("A", 10, 0, { course: "東", deliveryWindowTo: "08:00" }), s("B", 20, 0, { course: "東", deliveryWeekdays: [3] }), s("C", -5, 0, { course: "土だけ" })];
    const courses = [
      { id: "東", name: "東", departTime: "05:00", weekdays: [1, 2, 3], stops: ["A", "B"], dayOffset: 0 },
      { id: "土だけ", name: "土だけ", departTime: "05:00", weekdays: [6], dayOffset: 0 },
    ];
    const r = currentRoutes(depot, courses, customers, o({ weekday: 1, earliestDepart: "04:00", serviceMinutes: 10 }));
    expect(r.map((x) => x.name)).toEqual(["東"]);
    expect(r[0].ids).toEqual(["A"]); // B は水曜だけ
    expect(toHHMM(r[0].depart)).toBe("05:00");
    expect(toHHMM(r[0].latestDepart!)).toBe("07:45");
  });
});
