import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_COMPANY, getCompany, setCompany } from "../company";
import { HUB_SENDER } from "../channels/outbound/render";
import { getDb } from "../db/sqlite";

describe("自社の情報", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM kv WHERE key LIKE 'company_info%'");
  });

  it("初期値は架空の工場。保存すると発注書・返事の差出人（HUB_SENDER）も変わる", () => {
    expect(getCompany().name).toBe(DEFAULT_COMPANY.name);
    expect(HUB_SENDER.name).toBe(DEFAULT_COMPANY.name);
    setCompany({ name: "みどり製パン（テスト）", postalCode: "123-4567", address: "愛知県テスト市1-2", tel: "052-000-0000", fax: "052-000-0001", email: "order@test.example", contact: "購買 うえの" }, "はやし");
    expect(HUB_SENDER).toMatchObject({ name: "みどり製パン（テスト）", tel: "052-000-0000", fax: "052-000-0001", email: "order@test.example", contact: "購買 うえの" });
    expect(HUB_SENDER.address).toBe("〒123-4567 愛知県テスト市1-2");
  });

  it("形が違うもの・会社名なし・保存する人なしは止める", () => {
    expect(() => setCompany({ email: "not-mail" }, "はやし")).toThrow(/メール/);
    expect(() => setCompany({ postalCode: "12-34" }, "はやし")).toThrow(/郵便番号/);
    expect(() => setCompany({ tel: "abc" }, "はやし")).toThrow(/電話/);
    expect(() => setCompany({ name: " " }, "はやし")).toThrow(/会社名/);
    expect(() => setCompany({ name: "x" }, "")).toThrow();
  });
});
