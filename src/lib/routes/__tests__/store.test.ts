// ⑦ 配送コースの地図の保存（回る順番・コースの付け替え・コースを足す・昔のコース表の取り込み）。SQLite はメモリ。外へは通信しない。
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
beforeAll(() => {
  process.env.HUB_DB_PATH = ":memory:";
});

describe("配送コースの保存", () => {
  it("見本のデータで、東コース（朝便）の取引先が地図に出せる（位置あり）", async () => {
    const s = await import("../store");
    const d = await s.loadRouteData();
    const east = d.customers.filter((c) => c.course === "東コース（朝便）");
    expect(east.length).toBeGreaterThanOrEqual(3);
    expect(east.every((c) => c.lat != null)).toBe(true);
    expect(d.depot).toMatchObject({ lat: expect.any(Number), lng: expect.any(Number) });
  });

  it("回る順番を保存し、取引先を別のコースへ移すと、移した先の最後に入る", async () => {
    const s = await import("../store");
    await s.saveStops("東コース（朝便）", ["C09", "C07", "C01"], "事務");
    expect((await s.listCourses()).find((c) => c.id === "東コース（朝便）")?.stops).toEqual(["C09", "C07", "C01"]);
    await s.moveCustomer("C04", "東コース（朝便）", "事務");
    const d = await s.loadRouteData();
    expect(d.customers.find((c) => c.id === "C04")?.course).toBe("東コース（朝便）");
    expect(d.courses.find((c) => c.id === "東コース（朝便）")?.stops).toEqual(["C09", "C07", "C01", "C04"]);
  });

  it("コースを足す（おかしな時刻はだめ）", async () => {
    const s = await import("../store");
    expect(await s.upsertCourse({ id: "", name: "保育園コース", departTime: "25:00" }, "事務")).toEqual([expect.stringMatching(/出発時刻/)]);
    expect(await s.upsertCourse({ id: "", name: "保育園コース", departTime: "07:00", serviceMinutes: 15, vehicle: "軽バン" }, "事務")).toEqual([]);
    expect((await s.listCourses()).find((c) => c.id === "保育園コース")).toMatchObject({ departTime: "07:00", serviceMinutes: 15, vehicle: "軽バン", dayOffset: 0 });
  });

  it("昔のコース表の取り込み: 同じ名前は直す・新しい先は作る・新しいコースを作って順番を入れる", async () => {
    const s = await import("../store");
    const csv = [
      "名称,住所,曜日,納品時間,時間指定・注意事項,コース",
      "ひまわり保育園（デモ）,架空県ひまわり町,月・水,08:00〜09:00,門の前に止めない,北",
      "あたらしい食堂（デモ）,架空県あたらし町,火,06:30,,北",
    ].join("\n");
    const p = await s.previewImport(new TextEncoder().encode(csv), "見本.csv");
    expect(p.rows.map((r) => r.match)).toEqual(["same", "new"]);
    expect(p.courses).toEqual([{ name: "北", existing: undefined }]);
    const picks = p.rows.map((r) => ({ ...r, use: true, target: r.customerId ?? "new" }));
    const r = await s.applyImport(picks, "事務");
    expect(r).toMatchObject({ ok: true, added: 1, updated: 1, newCourses: ["北コース"] });
    const d = await s.loadRouteData();
    const north = d.courses.find((c) => c.id === "北コース")!;
    expect(north.departTime).toBe("06:00"); // いちばん早い 06:30 の 30 分前
    const [first, second] = north.stops!;
    expect(first).toBe("C01");
    const c01 = d.customers.find((c) => c.id === "C01")!;
    expect(c01).toMatchObject({ course: "北コース", address: "架空県ひまわり町", deliveryWindowFrom: "08:00", deliveryWindowTo: "09:00", deliveryCaution: "門の前に止めない" });
    expect(c01.lat).toBeUndefined(); // 住所が変わったので位置は出し直し
    expect(d.customers.find((c) => c.id === second)).toMatchObject({ name: "あたらしい食堂（デモ）", channel: "phone", deliveryTime: "06:30", deliveryMethod: "own" });
  });
});
