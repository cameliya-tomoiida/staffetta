// ⑦ 配送コースの地図の計算（時刻表・おすすめの順番・回る順の並べ方）と、昔のコース表の読み取り。架空のデータだけ。
import { describe, expect, it } from "vitest";
import { buildTimeline, distanceKm, orderedStops, suggestOrder, toHHMM, type Stop } from "../plan";
import { matchCustomers, normName, parseRouteGrids, toHHMM as cellTime, toWeekdays } from "../import";

const depot = { lat: 35.0, lng: 137.0 };
// 東へ 1 km ずつ並んだ先（緯度 35 度で経度 0.011 度 ≒ 1 km）
const east = (km: number) => ({ lat: 35.0, lng: 137.0 + km * 0.011 });
const stop = (id: string, km: number, extra: Partial<Stop> = {}): Stop => ({ id, name: `先${id}`, ...east(km), ...extra });
const settings = { roadFactor: 1, speedKmh: 60, trafficFactor: 1 }; // 1 km = 1 分

describe("時刻表", () => {
  it("出発 → 走る → 納品 → 帰社。1km=1分、1件10分", () => {
    const t = buildTimeline({ departTime: "06:00" }, depot, [stop("A", 2), stop("B", 5)], { settings });
    expect(distanceKm(depot, east(1))).toBeCloseTo(1.0, 1);
    expect(t.rows.map((r) => toHHMM(r.arrive))).toEqual(["06:02", "06:15"]); // 6:02 着・6:12 出・3分走って 6:15
    expect(toHHMM(t.back)).toBe("06:30"); // 6:25 出・5分で帰社
    expect(t.road).toBe(false);
  });

  it("希望より早く着けば待つ・遅れれば印。休けいは決めた件目のあと", () => {
    const t = buildTimeline(
      { departTime: "06:00", serviceMinutes: 5, breakMinutes: 30, breakAfter: 1 },
      depot,
      [stop("A", 2, { deliveryWindowFrom: "06:10" }), stop("B", 3, { deliveryWindowTo: "06:30" })],
      { settings },
    );
    expect(t.rows[0].wait).toBeCloseTo(8, 1);
    expect(t.rows[0].breakAfter).toBe(30);
    expect(toHHMM(t.rows[0].leave)).toBe("06:15");
    // 6:15 + 休けい 30 + 1 分 = 6:46 着 → 6:30 まで の希望に 16 分おくれ
    expect(toHHMM(t.rows[1].arrive)).toBe("06:46");
    expect(t.rows[1].late).toBeCloseTo(16, 1);
    expect(t.lateCount).toBe(1);
  });

  it("道の上の時間（legs）があればそれを使い、混み具合の係数をかける", () => {
    const t = buildTimeline({ departTime: "06:00", serviceMinutes: 0 }, depot, [stop("A", 2)], {
      settings: { ...settings, trafficFactor: 1.5 },
      legs: [{ minutes: 10, km: 4 }, { minutes: 10, km: 4 }],
    });
    expect(t.road).toBe(true);
    expect(toHHMM(t.back)).toBe("06:30");
    expect(t.kmTotal).toBe(8);
  });

  it("位置の無い先は走る時間 0 で、印を付ける", () => {
    const t = buildTimeline({ departTime: "06:00" }, depot, [stop("A", 2), { id: "X", name: "位置なし" }], { settings });
    expect(t.rows[1]).toMatchObject({ noPosition: true, driveMinutes: 0 });
  });

  it("日をまたぐ時刻は「翌」を付ける", () => {
    expect(toHHMM(24 * 60 + 15)).toBe("翌00:15");
  });
});

describe("おすすめの順番", () => {
  it("行ったり来たりの順番を、近い順に直す", () => {
    const stops = [stop("C", 9), stop("A", 1), stop("D", 12), stop("B", 4)];
    const before = buildTimeline({ departTime: "06:00" }, depot, stops, { settings });
    const ids = suggestOrder({ departTime: "06:00" }, depot, stops, settings);
    const after = buildTimeline({ departTime: "06:00" }, depot, ids.map((id) => stops.find((s) => s.id === id)!), { settings });
    expect(after.back).toBeLessThan(before.back);
    // 行き帰りは同じ道なので、A→B→C→D でも D→C→B→A でも同じ長さ
    expect([["A", "B", "C", "D"], ["D", "C", "B", "A"]]).toContainEqual(ids);
  });

  it("時間の希望（まで）が早い先は、遠回りでも先に回る", () => {
    const stops = [stop("near", 1), stop("far", 10, { deliveryWindowTo: "06:12" })];
    const ids = suggestOrder({ departTime: "06:00" }, depot, stops, settings);
    expect(ids[0]).toBe("far");
    const t = buildTimeline({ departTime: "06:00" }, depot, ids.map((id) => stops.find((s) => s.id === id)!), { settings });
    expect(t.lateCount).toBe(0);
  });

  it("位置の無い先は最後に残す", () => {
    const ids = suggestOrder({ departTime: "06:00" }, depot, [{ id: "X", name: "x" }, stop("B", 4), stop("A", 1)], settings);
    expect(ids.at(-1)).toBe("X");
  });
});

describe("回る順に並べる", () => {
  it("stops の順 → ほかのこのコースの先（ID 順）。もう別のコースの先・無効の先は外す", () => {
    const cs = [
      { id: "C01", course: "東", active: true },
      { id: "C02", course: "東", active: true },
      { id: "C03", course: "西", active: true },
      { id: "C04", course: "東", active: false },
      { id: "C05", course: "東", active: true },
    ];
    expect(orderedStops({ id: "東", stops: ["C05", "C03", "C01", "C04"] }, cs).map((c) => c.id)).toEqual(["C05", "C01", "C02"]);
  });
});

describe("昔のコース表の読み取り", () => {
  it("ルート表（見出しが3行目・担当がコース・曜日ごとに同じ先が何行も）", () => {
    const grid = {
      sheet: "見本コースルート表",
      rows: [
        [""],
        [""],
        ["得意先名", "担当", "曜日", "納品時間", "〜納品時間", "納品の仕方\n（指定あり）", "受発注", "郵便番号", "住所", "担当者", "連絡先", "注意事項"],
        ["みどり食堂（デモ）", "北", "月", "05:30", "", "裏口", "FAX", "000-0000", "架空県みどり市1", "", "", ""],
        ["そら保育園（デモ）", "北", "月", "06:00", "〜7:00", "", "", "", "架空県そら町", "", "", "門の前に止めない"],
        ["みどり食堂（デモ）", "北", "木", "05:30", "", "裏口", "FAX", "000-0000", "架空県みどり市1", "", "", ""],
      ],
    };
    const { rows, warnings } = parseRouteGrids([grid]);
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "みどり食堂（デモ）", course: "北", order: 1, deliveryTime: "05:30", deliveryWeekdays: [1, 4], deliveryHowTo: "裏口", postalCode: "000-0000" });
    expect(rows[1]).toMatchObject({ order: 2, deliveryWindowFrom: "06:00", deliveryWindowTo: "07:00", deliveryCaution: "門の前に止めない" });
  });

  it("マイマップ用の CSV（コースの列・納品時間に「〜」）", () => {
    const { rows } = parseRouteGrids([{
      sheet: "全コース",
      rows: [
        ["名称", "住所", "取引区分", "曜日", "納品時間", "時間指定・注意事項", "TEL", "コース"],
        ["うみ病院（デモ）", "架空県うみ市", "", "火・木・土", "05:00〜06:30", "", "", "南"],
        ["やま商店（デモ）", "架空県やま村", "", "毎日", "07:00", "", "", "西"],
      ],
    }]);
    expect(rows.map((r) => [r.course, r.order])).toEqual([["南", 1], ["西", 1]]);
    expect(rows[0]).toMatchObject({ deliveryWindowFrom: "05:00", deliveryWindowTo: "06:30", deliveryWeekdays: [2, 4, 6] });
    expect(rows[1].deliveryWeekdays).toHaveLength(7);
  });

  it("見出しが無いシートは読まずに知らせる", () => {
    expect(parseRouteGrids([{ sheet: "商品別", rows: [["商品", "単価"]] }]).warnings[0]).toMatch(/商品別/);
  });

  it("時刻と曜日の書き方", () => {
    expect(cellTime("5:00")).toBe("05:00");
    expect(cellTime("05:40:00")).toBe("05:40");
    expect(cellTime("〜6:30")).toBe("06:30");
    expect(cellTime("0.25")).toBe("06:00");
    expect(cellTime("朝")).toBeUndefined();
    expect(toWeekdays("月;水")).toEqual([1, 3]);
  });

  it("今の取引先と名前で突き合わせる（空白・株式会社・全角半角・（デモ）を気にしない）", () => {
    expect(normName("株式会社　ＡＢＣ食品（デモ）")).toBe(normName("ABC食品"));
    const m = matchCustomers(
      [
        { where: "", name: "ひまわり保育園", course: "東", order: 1 },
        { where: "", name: "ひまわり保育園 分園", course: "東", order: 2 },
        { where: "", name: "まったく新しい店", course: "東", order: 3 },
      ],
      [{ id: "C01", name: "ひまわり保育園（デモ）" }],
    );
    expect(m.map((x) => [x.match, x.customerId])).toEqual([["same", "C01"], ["similar", "C01"], ["new", undefined]]);
  });
});
