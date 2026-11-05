// ⑦ 取引先マスタの「配送の情報」（郵便番号・住所・納品の方法・定休日・納品時間の希望・納品の仕方・注意事項・位置）。
// CSV の一括登録と、管理画面の1行の保存の両方で入れられるか。
import { beforeAll, describe, expect, it, vi } from "vitest";
import { previewCsv } from "../csv";
import { customerDef } from "../defs";

vi.mock("server-only", () => ({}));
beforeAll(() => {
  process.env.HUB_DB_PATH = ":memory:";
});

const csv = (s: string) => new TextEncoder().encode(s);
const HEAD = "得意先ID,名前,主な注文の入口,注文の締め（前日）,郵便番号,住所,納品の方法,定休日,納品時間の希望（から）,納品時間の希望（まで）,納品の仕方,注意事項,緯度,経度";

describe("取引先の配送の情報（CSV）", () => {
  it("日本語の列名で読める（納品の方法は表示名・定休日は曜日の文字）", () => {
    const p = previewCsv(customerDef, csv(`${HEAD}\nC90,テスト食堂（デモ）,FAX,15:00,460-0008,愛知県名古屋市中区栄,自社便,土;日,07:00,09:00,裏口の棚,8時まで駐車できない,35.17,136.9\n`), [], {});
    expect(p.counts).toMatchObject({ add: 1, error: 0 });
    const r = p.rows[0];
    expect(r.kind).toBe("add");
    if (r.kind !== "add") return;
    expect(r.record).toMatchObject({
      postalCode: "460-0008", address: "愛知県名古屋市中区栄", deliveryMethod: "own", closedWeekdays: [0, 6],
      deliveryWindowFrom: "07:00", deliveryWindowTo: "09:00", deliveryHowTo: "裏口の棚", deliveryCaution: "8時まで駐車できない", lat: 35.17, lng: 136.9,
    });
  });

  it("おかしな値はエラーにする（郵便番号・時間の前後・緯度だけ・知らない方法）", () => {
    const bad = [
      "C91,A,FAX,15:00,4600008x,,,,,,,,,",
      "C92,B,FAX,15:00,,,,,10:00,09:00,,,,",
      "C93,C,FAX,15:00,,,,,,,,,35.1,",
      "C94,D,FAX,15:00,,,ドローン,,,,,,,",
    ];
    const p = previewCsv(customerDef, csv(`${HEAD}\n${bad.join("\n")}\n`), [], {});
    expect(p.rows.map((r) => r.kind)).toEqual(["error", "error", "error", "error"]);
    const msg = p.rows.flatMap((r) => (r.kind === "error" ? r.errors.map((e) => e.message) : [])).join("／");
    expect(msg).toMatch(/郵便番号/);
    expect(msg).toMatch(/「から」を「まで」より前/);
    expect(msg).toMatch(/緯度と経度は両方/);
  });
});

describe("取引先の配送の情報（管理画面の保存）", () => {
  it("保存でき、空にすると消える。住所を変えると位置は出し直しになる", async () => {
    const c = await import("@/lib/channels/line/customers");
    const base = { id: "C03", name: "みなと給食センター", channel: "fax", cutoff: "14:00", deliveryTime: "09:00", course: "西コース", active: true };
    const full = {
      ...base, postalCode: "455-0000", address: "愛知県名古屋市港区", deliveryMethod: "own", closedWeekdays: "土;日",
      deliveryWindowFrom: "08:30", deliveryWindowTo: "09:30", deliveryHowTo: "検収室の前", deliveryCaution: "門は8時から", lat: 35.1, lng: 136.88,
    };
    expect(await c.upsertCustomerRow(full, "事務")).toMatchObject({ ok: true });
    expect(await c.getCustomerSettings("C03")).toMatchObject({ postalCode: "455-0000", deliveryMethod: "own", closedWeekdays: [0, 6], lat: 35.1, lng: 136.88 });

    // 住所だけ変えた → 位置は消える（地図の画面で出し直す）
    expect(await c.upsertCustomerRow({ ...full, address: "愛知県名古屋市南区" }, "事務")).toMatchObject({ ok: true });
    const moved = await c.getCustomerSettings("C03");
    expect(moved?.address).toBe("愛知県名古屋市南区");
    expect(moved?.lat).toBeUndefined();

    // 空にすると消える
    const empty = { ...base, postalCode: "", address: "", deliveryMethod: "", closedWeekdays: "", deliveryWindowFrom: "", deliveryWindowTo: "", deliveryHowTo: "", deliveryCaution: "", lat: "", lng: "" };
    expect(await c.upsertCustomerRow(empty, "事務")).toMatchObject({ ok: true });
    const after = await c.getCustomerSettings("C03");
    expect(after?.address).toBeUndefined();
    expect(after?.closedWeekdays).toBeUndefined();
    expect(after?.deliveryMethod).toBeUndefined();

    // おかしい値は保存しない
    expect(await c.upsertCustomerRow({ ...base, closedWeekdays: "祝" }, "事務")).toMatchObject({ ok: false, field: "closedWeekdays" });
    expect(await c.upsertCustomerRow({ ...base, deliveryWindowFrom: "10:00", deliveryWindowTo: "09:00" }, "事務")).toMatchObject({ ok: false });
  });

  it("見本の取引先には架空の配送の情報が入っている（町の名前まで）", async () => {
    const { sampleCustomers } = await import("@/lib/db/seed/customers");
    const own = sampleCustomers().filter((x) => x.deliveryMethod === "own");
    expect(own.length).toBeGreaterThan(5);
    for (const x of own) {
      expect(x.lat).toBeTypeOf("number");
      expect(x.address).not.toMatch(/\d/); // 番地は入れない
    }
  });

  it("管理画面の列に出る（納品の仕方・注意事項は広い欄）", async () => {
    const { adminCustomerColumns } = await import("../customers");
    const cols = adminCustomerColumns();
    expect(cols.find((x) => x.key === "deliveryMethod")).toMatchObject({ type: "select", list: true });
    expect(cols.find((x) => x.key === "deliveryHowTo")?.type).toBe("textarea");
    expect(cols.find((x) => x.key === "lat")?.type).toBe("number");
  });
});
