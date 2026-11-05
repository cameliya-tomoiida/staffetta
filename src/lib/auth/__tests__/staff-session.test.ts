// ④ スタッフの「LINE でログイン」の cookie（署名・期限・行き先）と、ログインできる人の判定。
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createStaffSession, safeNext, staffCookieOptions, verifyStaffSession } from "@/lib/auth/staff-session";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const KEY = "k".repeat(40); // 試験用の秘密（架空）
const T0 = Date.parse("2026-11-05T11:30:00+09:00");

describe("cookie の署名と期限", () => {
  it("作った値は確かめられ、12時間で切れる", () => {
    const v = createStaffSession({ userId: "U_demo_staff_koide", name: "工場長 こいで" }, T0, KEY)!;
    expect(verifyStaffSession(v, T0 + 3600_000, KEY)).toMatchObject({ u: "U_demo_staff_koide", n: "工場長 こいで" });
    expect(verifyStaffSession(v, T0 + 12 * 3600_000 - 1, KEY)).toBeTruthy();
    expect(verifyStaffSession(v, T0 + 12 * 3600_000, KEY)).toBeUndefined();
  });

  it("書き換えた値・別の秘密・こわれた値は通さない", () => {
    const v = createStaffSession({ userId: "U1", name: "a" }, T0, KEY)!;
    const [body, sig] = v.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "U2", n: "a", exp: T0 + 9e9 })).toString("base64url");
    expect(verifyStaffSession(`${forged}.${sig}`, T0, KEY)).toBeUndefined();
    expect(verifyStaffSession(v, T0, "x".repeat(40))).toBeUndefined();
    expect(verifyStaffSession(`${body}.`, T0, KEY)).toBeUndefined();
    expect(verifyStaffSession("abc", T0, KEY)).toBeUndefined();
    expect(verifyStaffSession(`${v}.x`, T0, KEY)).toBeUndefined();
    expect(verifyStaffSession(undefined, T0, KEY)).toBeUndefined();
  });

  it("秘密が無い・短いときは、作らない・通さない", () => {
    expect(createStaffSession({ userId: "U1", name: "a" }, T0, "")).toBeUndefined();
    expect(createStaffSession({ userId: "U1", name: "a" }, T0, "short")).toBeUndefined();
    const v = createStaffSession({ userId: "U1", name: "a" }, T0, KEY)!;
    expect(verifyStaffSession(v, T0, "")).toBeUndefined();
  });

  it("cookie は HttpOnly・Secure・SameSite=Lax・12時間", () => {
    expect(staffCookieOptions).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", maxAge: 43200 });
  });

  it("行き先はアプリの中のパスだけ", () => {
    expect(safeNext("/purchase?d=2026-11-06")).toBe("/purchase?d=2026-11-06");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil", "purchase", "/liff/staff?to=/", "/api/backup", "/x\r\nSet-Cookie: a", undefined, null, ""]) {
      expect(safeNext(bad)).toBe("/");
    }
  });
});

describe("ログインできる人・通知のリンク", () => {
  beforeAll(() => {
    process.env.HUB_DB_PATH = ":memory:";
  });

  it("登録したスタッフだけ。登録していない人・お客さんにひも付いた人は入れない", async () => {
    vi.doMock("@/lib/store", () => import("@/lib/channels/__tests__/memdb"));
    const st = await import("@/lib/channels/line/state");
    const sa = await import("@/lib/channels/line/staff-alerts");
    await st.touchUser("U_demo_staff_koide", { displayName: "こいで" });
    await st.touchUser("U_demo_cust", { displayName: "お客さん" });
    await sa.addStaffLine({ userId: "U_demo_staff_koide", name: "工場長 こいで" }, "事務");
    expect(await sa.staffLoginCheck("U_demo_staff_koide")).toEqual({ ok: true, name: "工場長 こいで" });
    expect(await sa.staffLoginCheck("U_demo_nobody")).toMatchObject({ ok: false });
    // あとからお客さんにひも付いた
    await st.updateLineState((x) => {
      x.users["U_demo_staff_koide"] = { ...x.users["U_demo_staff_koide"], customerId: "C04" };
    });
    expect(await sa.staffLoginCheck("U_demo_staff_koide")).toMatchObject({ ok: false, error: expect.stringMatching(/お客さん/) });
  });

  it("通知のリンク: 外の URL があれば LINE でログインを通る形、無ければ工場の中の URL", async () => {
    const sa = await import("@/lib/channels/line/staff-alerts");
    process.env.HUB_APP_URL = "http://192.168.0.10:3100";
    delete process.env.HUB_PUBLIC_URL;
    expect(sa.staffLink("/purchase")).toBe("http://192.168.0.10:3100/purchase");
    process.env.HUB_PUBLIC_URL = "https://hub.example.test/";
    expect(sa.staffLink("/purchase?d=2026-11-06")).toBe("https://hub.example.test/liff/staff?to=%2Fpurchase%3Fd%3D2026-11-06");
    delete process.env.HUB_PUBLIC_URL;
  });
});
