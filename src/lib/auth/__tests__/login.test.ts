import { beforeEach, describe, expect, it } from "vitest";
import { canOpen, homeOf } from "../roles";
import { createUserSession, hashPassword, verifyPassword, verifyUserSession } from "../user-session";
import { getDb } from "@/lib/db/sqlite";
import { accountsExist, checkLogin, createFirstAdmin, listStaff, publicStaff, saveStaff, setPassword, SAMPLE_STAFF } from "@/lib/staff";
import { alertForRole } from "@/lib/home";

const KEY = "test-key";
const T0 = Date.parse("2026-11-06T09:00:00+09:00");

describe("役割ごとに見られる画面", () => {
  it("管理者は全部、事務は設定以外、工場は製造の関係、配送は /driver だけ", () => {
    for (const p of ["/", "/orders", "/settings/features", "/settings/staff", "/plan"]) expect(canOpen("管理者", p)).toBe(true);
    expect(canOpen("事務", "/")).toBe(true);
    expect(canOpen("事務", "/purchase?date=2026-11-06")).toBe(true);
    expect(canOpen("事務", "/settings/features")).toBe(false);
    expect(canOpen("事務", "/settings/staff")).toBe(false);
    expect(canOpen("工場", "/plan?date=2026-11-06")).toBe(true);
    expect(canOpen("工場", "/cards/2026-11-06")).toBe(true);
    expect(canOpen("工場", "/masters/materials")).toBe(true);
    expect(canOpen("工場", "/hygiene")).toBe(true);
    expect(canOpen("工場", "/")).toBe(false);
    expect(canOpen("工場", "/purchase")).toBe(false);
    expect(canOpen("工場", "/masters/customers")).toBe(false);
    expect(canOpen("配送", "/driver")).toBe(true);
    expect(canOpen("配送", "/home")).toBe(false);
    expect(canOpen("配送", "/orders")).toBe(false);
    // ログインの画面は、だれでも
    for (const r of ["事務", "工場", "配送"] as const) expect(canOpen(r, "/login")).toBe(true);
    expect(homeOf("配送")).toBe("/driver");
    expect(homeOf("工場")).toBe("/home");
  });

  it("お知らせは、その役割に要らない種類を出さない（管理者は全部）", () => {
    expect(alertForRole("stock_shortage", "工場")).toBe(true);
    expect(alertForRole("review_backlog", "工場")).toBe(false);
    expect(alertForRole("review_backlog", "事務")).toBe(true);
    expect(alertForRole("margin_low", "事務")).toBe(false);
    expect(alertForRole("margin_low", "管理者")).toBe(true);
  });
});

describe("ログインの印とパスワード", () => {
  it("署名を確かめる。書きかえ・期限切れ・違う鍵は通さない", () => {
    const v = createUserSession({ id: "ST06", name: "はやし", role: "管理者" }, T0, KEY);
    expect(verifyUserSession(v, T0 + 3600_000, KEY)).toMatchObject({ id: "ST06", n: "はやし", r: "管理者" });
    expect(verifyUserSession(v, T0 + 13 * 3600_000, KEY)).toBeUndefined();
    expect(verifyUserSession(v, T0, "other-key")).toBeUndefined();
    const [body, mac] = v.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), r: "管理者", id: "ST01" })).toString("base64url");
    expect(verifyUserSession(`${forged}.${mac}`, T0, KEY)).toBeUndefined();
    expect(verifyUserSession(undefined, T0, KEY)).toBeUndefined();
  });

  it("パスワードはハッシュで持ち、元の文字は残さない", () => {
    const h = hashPassword("correct horse");
    expect(h).not.toContain("correct");
    expect(h).not.toBe(hashPassword("correct horse")); // 塩が毎回違う
    expect(verifyPassword("correct horse", h)).toBe(true);
    expect(verifyPassword("wrong horse", h)).toBe(false);
    expect(verifyPassword("x", undefined)).toBe(false);
  });
});

describe("スタッフのログイン", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM kv WHERE key LIKE 'staff_members%'");
  });

  it("管理者がいない間はログイン不要。最初の管理者を作ると要るようになる", () => {
    expect(accountsExist()).toBe(false);
    const me = createFirstAdmin({ name: "はやし", username: "hayashi", password: "pass-1234" });
    expect(me).toMatchObject({ id: "ST06", role: "管理者" }); // 見本の同じ名前の人に付ける
    expect(accountsExist()).toBe(true);
    expect(() => createFirstAdmin({ name: "べつ", username: "other", password: "pass-1234" })).toThrow(/もういます/);
    expect(checkLogin("HAYASHI", "pass-1234")?.name).toBe("はやし");
    expect(checkLogin("hayashi", "wrong-pass")).toBeUndefined();
    // 画面に渡す形にハッシュは入らない
    expect(JSON.stringify(publicStaff(true))).not.toContain("scrypt$");
    expect(publicStaff(true).find((s) => s.id === "ST06")?.hasPassword).toBe(true);
  });

  it("まとめて保存してもパスワードは消えない。パスワードのある管理者は1人残す。短いパスワードは止める", () => {
    createFirstAdmin({ name: "はやし", username: "hayashi", password: "pass-1234" });
    const list = publicStaff(true).map((s) => (s.name === "もりた" ? { ...s, username: "morita" } : s));
    saveStaff(list, "はやし");
    expect(checkLogin("hayashi", "pass-1234")).toBeTruthy();
    expect(() => setPassword("ST05", "short", "はやし")).toThrow(/8文字/);
    setPassword("ST05", "factory-pass", "はやし");
    expect(checkLogin("morita", "factory-pass")).toMatchObject({ role: "工場" });
    expect(() => setPassword("ST01", "office-pass", "はやし")).toThrow(/ユーザー名/);
    // 管理者を事務にすると、パスワードのある管理者がいなくなる → 止める
    expect(() => saveStaff(publicStaff(true).map((s) => (s.id === "ST06" ? { ...s, role: "事務" as const } : s)), "はやし")).toThrow(/管理者を1人/);
    // ユーザー名の重複・形
    expect(() => saveStaff(publicStaff(true).map((s) => (s.id === "ST01" ? { ...s, username: "Hayashi" } : s)), "はやし")).toThrow(/ユーザー名/);
    expect(() => saveStaff(publicStaff(true).map((s) => (s.id === "ST01" ? { ...s, username: "た な か" } : s)), "はやし")).toThrow(/半角/);
    expect(listStaff().length).toBe(SAMPLE_STAFF.length);
  });
});
