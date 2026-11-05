import { beforeEach, describe, expect, it } from "vitest";
import type { CustomerMaster } from "@/data/types";
import { DEMO_DATE } from "@/data/demo-orders";
import { allProducts } from "@/lib/catalog";
import { sampleCustomers } from "@/lib/db/seed/customers";
import { getDb } from "@/lib/db/sqlite";
import { driverDemoOrders } from "@/lib/demo-reset";
import { SAMPLE_COURSES } from "@/lib/masters/seed";
import { DEFAULT_DEPOT } from "@/lib/routes/store";
import { findStaffByName, listStaff, saveStaff, SAMPLE_STAFF } from "@/lib/staff";
import { driverDay } from "../day";

const customers = sampleCustomers() as unknown as CustomerMaster[];
const product = (id: string) => {
  const p = allProducts().find((x) => x.id === id);
  return p ? { name: p.name, unit: p.unit } : undefined;
};
const course = (id: string) => SAMPLE_COURSES.find((c) => c.id === id)!;

describe("配送の画面（/driver）のその日の配送", () => {
  it("見本のコースは2つとも6件。回る順は便のマスタの順、着く時刻はだんだん遅くなる", () => {
    for (const id of ["東コース（朝便）", "西コース"]) {
      const d = driverDay({ course: course(id), customers, orders: driverDemoOrders(), date: DEMO_DATE, depot: DEFAULT_DEPOT, product });
      expect(d.stops).toHaveLength(6);
      const on = d.stops.filter((s) => !s.off);
      expect(on.map((s) => s.no)).toEqual(on.map((_, i) => i + 1));
      const times = on.map((s) => s.arrive!);
      expect([...times].sort()).toEqual(times);
      expect(d.back! > times.at(-1)!).toBe(true);
    }
    const east = driverDay({ course: course("東コース（朝便）"), customers, orders: [], date: DEMO_DATE, depot: DEFAULT_DEPOT, product });
    expect(east.stops.map((s) => s.id)).toEqual(["DV01", "C09", "C01", "DV02", "DV03", "C07"]);
  });

  it("各先に渡すもの: その日の確定・要確認・仮発注（印つき）。ほかの日の注文は入れない", () => {
    const d = driverDay({ course: course("西コース"), customers, orders: driverDemoOrders(), date: DEMO_DATE, depot: DEFAULT_DEPOT, product });
    const c17 = d.stops.find((s) => s.id === "DV04")!;
    expect(c17.items.map((i) => [i.productId, i.quantity, i.status])).toEqual([["P01", 150, "confirmed"], ["P03", 10, "confirmed"]]);
    expect(d.stops.find((s) => s.id === "DV06")!.items.every((i) => i.status === "provisional")).toBe(true);
    // 納品の仕方・注意・時間の希望・定休日も出す
    expect(c17).toMatchObject({ window: "05:45〜06:30", closedDays: "日・土" });
    expect(c17.howTo).toBeTruthy();
    expect(c17.caution).toBeTruthy();
  });

  it("定休日の先は「お休み」として後ろに回し、渡すものは出さない", () => {
    // 11/9 は月曜。カフェもくれん（DV05）は月曜が定休日
    const d = driverDay({ course: course("西コース"), customers, orders: driverDemoOrders(), date: "2026-11-09", depot: DEFAULT_DEPOT, product });
    const off = d.stops.filter((s) => s.off);
    expect(off.map((s) => s.id)).toContain("DV05");
    expect(d.stops.at(-1)!.off).toBe(true);
    expect(off.every((s) => s.items.length === 0 && s.no === 0)).toBe(true);
  });
});

describe("いつもの商品（⑦の取引先の商品）", () => {
  it("その曜日によく出るものを先に、数の多い順。注文の無い日でも出す", () => {
    const cp = [
      { customerId: "C01", code: "A", name: "ロール", productId: "P01", quantity: 100, weekdays: [1, 3], active: true },
      { customerId: "C01", code: "B", name: "食パン", productId: "P03", quantity: 300, weekdays: [2], active: true },
      { customerId: "C01", code: "C", name: "古い品", quantity: 999, weekdays: [5], active: false },
      { customerId: "C09", code: "D", name: "ほかの先", quantity: 50, active: true },
    ];
    // 11/9 は月曜
    const d = driverDay({ course: course("東コース（朝便）"), customers, orders: [], date: "2026-11-09", depot: DEFAULT_DEPOT, product, customerProducts: cp });
    const c01 = d.stops.find((s) => s.id === "C01")!;
    expect(c01.items).toEqual([]);
    expect(c01.usual).toEqual([
      { name: "バターロール", unit: "個", weekdays: "月・水", today: true },
      { name: "食パン 8枚切", unit: "斤", weekdays: "火", today: false },
    ]);
    expect(d.stops.find((s) => s.id === "C14" || s.id === "DV01")!.usual).toEqual([]);
  });
});

describe("スタッフの登録", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM kv WHERE key LIKE 'staff_members%'");
  });

  it("空なら見本。担当コースつきで保存でき、LINE の名前（さん付きでも）から探せる", () => {
    expect(listStaff().map((s) => s.name)).toEqual(SAMPLE_STAFF.map((s) => s.name));
    saveStaff([...SAMPLE_STAFF, { id: "", name: " やまだ ", role: "配送", courses: ["西コース", "西コース"], active: true }], "はやし");
    expect(findStaffByName("やまださん")).toMatchObject({ name: "やまだ", role: "配送", courses: ["西コース"] });
    expect(findStaffByName("グエン")?.courses).toEqual(["東コース（朝便）"]);
  });

  it("無効にした人は選ぶ所に出ない。同じ名前は2人入れられない", () => {
    saveStaff(SAMPLE_STAFF.map((s) => (s.name === "さとう" ? { ...s, active: false } : s)), "はやし");
    expect(listStaff().map((s) => s.name)).not.toContain("さとう");
    expect(listStaff(true).map((s) => s.name)).toContain("さとう");
    expect(() => saveStaff([...SAMPLE_STAFF, { ...SAMPLE_STAFF[0], id: "ST99" }], "はやし")).toThrow(/同じ名前/);
    expect(() => saveStaff(SAMPLE_STAFF, "")).toThrow();
  });
});
