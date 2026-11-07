// API ごとの許可役割（セキュリティの確認 11/7）
import { describe, expect, it } from "vitest";
import { decideActionAccess } from "../action-guard";

const api = (pathname: string, role?: "管理者" | "事務" | "工場" | "配送" | "営業") => decideActionAccess({ accountsOn: true, role, pathname, isServerAction: false }).kind;

describe("API の役割", () => {
  it("マスタ・自動化・発注の送信は 管理者・事務だけ", () => {
    expect(api("/api/masters/products", "工場")).toBe("forbid");
    expect(api("/api/masters/products", "事務")).toBe("next");
    expect(api("/api/automation", "配送")).toBe("forbid");
    expect(api("/api/outbound", "営業")).toBe("forbid");
    expect(api("/api/outbound", "管理者")).toBe("next");
  });
  it("伝票は営業も・バックアップは管理者だけ・ログインなしは 401", () => {
    expect(api("/api/slips/sales", "営業")).toBe("next");
    expect(api("/api/slips/sales", "工場")).toBe("forbid");
    expect(api("/api/backup", "事務")).toBe("forbid");
    expect(api("/api/alerts")).toBe("unauthorized");
    expect(api("/api/alerts", "工場")).toBe("next");
  });
});
