import { describe, expect, it } from "vitest";
import { decideTunnelAccess } from "../tunnel-access";

const html = "text/html,application/xhtml+xml";
const base = { viaTunnel: true, method: "GET", accept: html, staffOk: false };

describe("トンネル経由のアクセス", () => {
  it("社内 PC（トンネルを通らない）は全部通す", () => {
    expect(decideTunnelAccess({ ...base, viaTunnel: false, pathname: "/settings/backup" }).kind).toBe("next");
  });

  it("受け口・LINE のミニアプリ・JS はログイン無しで通す", () => {
    for (const p of ["/api/fax/inbound", "/api/line/webhook", "/liff", "/liff/order", "/liff/staff", "/_next/static/x.js"])
      expect(decideTunnelAccess({ ...base, pathname: p }).kind).toBe("next");
    // 似た名前は通さない
    expect(decideTunnelAccess({ ...base, pathname: "/liffx", accept: "*/*" }).kind).toBe("forbid");
    expect(decideTunnelAccess({ ...base, pathname: "/api/fax/inbound-x", accept: "*/*" }).kind).toBe("forbid");
  });

  it("ログインしていない人: 画面はログインの入口へ（元のパスを next に）、API とボタンは 403", () => {
    expect(decideTunnelAccess({ ...base, pathname: "/orders", search: "?d=1" })).toEqual({ kind: "login", location: "/liff/staff?next=%2Forders%3Fd%3D1" });
    expect(decideTunnelAccess({ ...base, pathname: "/api/backup" }).kind).toBe("forbid");
    expect(decideTunnelAccess({ ...base, pathname: "/orders", method: "POST" }).kind).toBe("forbid");
    expect(decideTunnelAccess({ ...base, pathname: "/orders", isServerAction: true }).kind).toBe("forbid");
    expect(decideTunnelAccess({ ...base, pathname: "/orders", accept: "*/*" }).kind).toBe("forbid");
  });

  it("スタッフがログインしていれば、全部のページ・API・ボタンを通す", () => {
    for (const [pathname, method] of [["/orders", "GET"], ["/api/alerts", "GET"], ["/fax/F001", "POST"]])
      expect(decideTunnelAccess({ ...base, pathname, method, staffOk: true }).kind).toBe("next");
  });
});
