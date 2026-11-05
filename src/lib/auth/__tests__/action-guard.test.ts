import { describe, expect, it } from "vitest";
import { decideActionAccess } from "../action-guard";

const act = (pathname: string, role?: Parameters<typeof decideActionAccess>[0]["role"], accountsOn = true) =>
  decideActionAccess({ accountsOn, role, pathname, isServerAction: true }).kind;
const api = (pathname: string, role?: Parameters<typeof decideActionAccess>[0]["role"], accountsOn = true) =>
  decideActionAccess({ accountsOn, role, pathname, isServerAction: false }).kind;

describe("ボタンの処理（Server Actions）と API の役割の止め", () => {
  it("ログインを使っていない間は、今までどおり全部通す", () => {
    expect(act("/settings/staff", undefined, false)).toBe("next");
    expect(api("/api/backup", undefined, false)).toBe("next");
  });

  it("ログインしていない人のボタンは止める（ログイン・最初の管理者・LINE の画面は通す）", () => {
    expect(act("/orders")).toBe("unauthorized");
    expect(act("/settings/staff")).toBe("unauthorized");
    expect(act("/login")).toBe("next");
    expect(act("/setup")).toBe("next");
    expect(act("/liff/order")).toBe("next");
  });

  it("その役割で開けない画面のボタンは押せない", () => {
    // 工場: 設定・受注・発注書のボタンは止める。製造計画・製品カードは通す
    expect(act("/settings/staff", "工場")).toBe("forbid");
    expect(act("/settings/ai", "工場")).toBe("forbid");
    expect(act("/orders", "工場")).toBe("forbid");
    expect(act("/purchase", "工場")).toBe("forbid");
    expect(act("/plan", "工場")).toBe("next");
    expect(act("/cards/templates", "工場")).toBe("next");
    // 事務: 設定だけ止める
    expect(act("/settings/features", "事務")).toBe("forbid");
    expect(act("/fax/F001", "事務")).toBe("next");
    // 配送: /driver だけ
    expect(act("/driver", "配送")).toBe("next");
    expect(act("/orders/new", "配送")).toBe("forbid");
    // 管理者: 全部
    expect(act("/settings/staff", "管理者")).toBe("next");
  });

  it("API はログインが要る（FAX・LINE の受け口は通す）。全データの書き出しは管理者だけ", () => {
    expect(api("/api/today")).toBe("unauthorized");
    expect(api("/api/today", "工場")).toBe("next");
    expect(api("/api/fax/inbound")).toBe("next");
    expect(api("/api/line/webhook")).toBe("next");
    expect(api("/api/backup", "事務")).toBe("forbid");
    expect(api("/api/backup", "管理者")).toBe("next");
    // 画面を開く（GET・ボタンでない）はここでは止めない（layout が止める）
    expect(decideActionAccess({ accountsOn: true, pathname: "/settings/staff", isServerAction: false }).kind).toBe("next");
  });
});
