import { describe, expect, it } from "vitest";
import type { CourseMaster, CustomerMaster, Order } from "@/data/types";
import { bestSlot, serviceForPieces } from "../plan";
import { bestStopOrder, DEFAULT_OPTIMIZE } from "../optimize";
import { driverDay } from "@/lib/driver/day";

const depot = { lat: 35.15, lng: 136.85, name: "工場" };
const cust = (id: string, lat: number, lng: number, extra: Partial<CustomerMaster> = {}): CustomerMaster =>
  ({ id, name: id, channel: "fax", cutoff: "15:00", course: "A", lat, lng, deliveryMethod: "own", active: true, ...extra }) as CustomerMaster;
const course = { id: "A", name: "Aコース", departTime: "06:00", loadMinutes: 0, dayOffset: 0, weekdays: [1, 2, 3, 4, 5, 6], active: true, stops: ["C1", "C2", "C3"] } as CourseMaster;
const order = (id: string, customerId: string, date: string, pieces: number): Order =>
  ({ id, customerId, deliveryDate: date, status: "confirmed", intent: "new", createdAt: `${date}T00:00:00Z`, edits: [], source: { channel: "fax", refs: [], receivedAt: `${date}T00:00:00Z` },
    lines: [{ id: `${id}-1`, productId: "P01", quantity: pieces, unit: "個", piecesPerUnit: 1, pieces, confidence: 1, edits: [] }] }) as Order;

describe("その日のコース（⑧ 11/7）", () => {
  it("納品にかかる時間は 届ける数で 5〜20分（分からない日は 10分）", () => {
    expect(serviceForPieces(20)).toBe(5);
    expect(serviceForPieces(150)).toBe(10);
    expect(serviceForPieces(400)).toBe(15);
    expect(serviceForPieces(900)).toBe(20);
    expect(serviceForPieces(undefined)).toBe(10);
  });

  it("追加の届け先は、走る距離がいちばん増えない所に入る", () => {
    const line = [{ lat: 35.25, lng: 136.85 }, { lat: 35.25, lng: 137.05 }];
    expect(bestSlot(depot, line, { lat: 35.25, lng: 136.95 })).toBe(1); // 1件目と2件目の間（東へ行く途中）
  });

  it("回る順の見直しは、行ったり来たりしない順にする（近い順 → 交差をほどく）", () => {
    const stops = [cust("N2", 35.35, 136.85), cust("N1", 35.25, 136.85), cust("N3", 35.45, 136.85)];
    const ids = bestStopOrder(depot, stops, { ...DEFAULT_OPTIMIZE, weekday: 1, settings: { roadFactor: 1.4, speedKmh: 25, trafficFactor: 1.2 } });
    expect(ids).toEqual(["N1", "N2", "N3"]);
  });

  it("配送の画面: ふだんその曜日に来ない先でも、その日に注文があれば「追加」で回る順に入る", () => {
    const customers = [cust("C1", 35.2, 136.85), cust("C2", 35.3, 136.85), cust("C3", 35.4, 136.85, { deliveryWeekdays: [3] })];
    const date = "2026-11-09"; // 月曜（C3 はふだん水曜だけ）
    const d = driverDay({ course, customers, orders: [order("O1", "C1", date, 30), order("O3", "C3", date, 600)], date, depot, product: () => ({ name: "バターロール", unit: "個" }) });
    const c3 = d.stops.find((s) => s.id === "C3")!;
    expect(c3.added).toBe(true);
    expect(c3.no).toBeGreaterThan(0);
  });
});
