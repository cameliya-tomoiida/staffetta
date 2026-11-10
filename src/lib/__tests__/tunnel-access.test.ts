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

  it("全データの書き出し（/api/backup）は、ログインしていてもトンネル経由では通さない（LAN だけ）", () => {
    expect(decideTunnelAccess({ ...base, pathname: "/api/backup", staffOk: true }).kind).toBe("forbid");
    expect(decideTunnelAccess({ ...base, pathname: "/api/backup", viaTunnel: false }).kind).toBe("next");
    expect(decideTunnelAccess({ ...base, pathname: "/settings/backup", method: "POST", isServerAction: true, staffOk: true }).kind).toBe("forbid");
  });
});

// 外からの判定（管理役2 11/7: 入口を Tailscale Funnel に切りかえた。Cloudflare の見出しだけでは、外からでも「社内」になっていた）
import { fromOutside } from "../tunnel-access";
describe("fromOutside", () => {
  const H = (o: Record<string, string>) => new Headers(o);
  it("Tailscale Funnel・Cloudflare の見出しは外", () => {
    expect(fromOutside(H({ host: "127.0.0.1:3100", "tailscale-funnel-request": "?1" }), "")).toBe(true);
    expect(fromOutside(H({ host: "localhost:3100", "cf-ray": "x" }), "")).toBe(true);
  });
  it("宛先の名前が ts.net・公開の URL なら外", () => {
    expect(fromOutside(H({ host: "demo-pc.tailnet-example.ts.net" }), "")).toBe(true);
    expect(fromOutside(H({ host: "127.0.0.1:3100", "x-forwarded-host": "demo-pc.tailnet-example.ts.net" }), "")).toBe(true);
    expect(fromOutside(H({ host: "hub.example.jp" }), "https://hub.example.jp")).toBe(true);
  });
  it("社内の LAN・localhost は外ではない", () => {
    expect(fromOutside(H({ host: "192.0.2.34:3100", "x-forwarded-for": "192.0.2.20" }), "https://demo-pc.tailnet-example.ts.net")).toBe(false);
    expect(fromOutside(H({ host: "localhost:3100" }), "https://demo-pc.tailnet-example.ts.net")).toBe(false);
  });
});

// 審査員向けの見本（HUB_DEMO=1・11/8）: 外からでも ID・パスワードのログインを通す。書き出し・戻しは閉じたまま
describe("decideTunnelAccess（見本）", () => {
  const d = { ...base, demo: true };
  it("ログインの画面・ログインのボタン（Server Action）・ロゴは通す", () => {
    expect(decideTunnelAccess({ ...d, pathname: "/login" }).kind).toBe("next");
    expect(decideTunnelAccess({ ...d, pathname: "/login", method: "POST", isServerAction: true, accept: "text/x-component" }).kind).toBe("next");
    expect(decideTunnelAccess({ ...d, pathname: "/brand/staffetta-logo-dark.svg", accept: "image/*" }).kind).toBe("next");
  });
  it("ログイン前のほかの画面は /login へ、API は 403", () => {
    expect(decideTunnelAccess({ ...d, pathname: "/orders" })).toEqual({ kind: "login", location: "/login?next=%2Forders" });
    expect(decideTunnelAccess({ ...d, pathname: "/api/stock", method: "POST", accept: "application/json" }).kind).toBe("forbid");
    expect(decideTunnelAccess({ ...d, pathname: "/setup" }).kind).toBe("login");
    expect(decideTunnelAccess({ ...d, pathname: "/samples/fax1.pdf", accept: "application/pdf" }).kind).toBe("forbid");
  });
  it("ログインしたら通す。ただし書き出し・戻しは外からは閉じたまま", () => {
    expect(decideTunnelAccess({ ...d, loggedIn: true, pathname: "/orders" }).kind).toBe("next");
    expect(decideTunnelAccess({ ...d, loggedIn: true, pathname: "/settings/backup" }).kind).toBe("forbid");
    expect(decideTunnelAccess({ ...d, loggedIn: true, pathname: "/api/backup" }).kind).toBe("forbid");
  });
  it("本番（demo なし）では、ID・パスワードのログインがあっても外からは通さない（今までどおり）", () => {
    expect(decideTunnelAccess({ ...base, loggedIn: true, pathname: "/orders" }).kind).toBe("login");
    expect(decideTunnelAccess({ ...base, pathname: "/login" }).kind).toBe("login");
  });
});

describe("fromOutside（Render の見本）", () => {
  it("*.onrender.com は外", () => {
    expect(fromOutside(new Headers({ host: "staffetta-demo.onrender.com" }), "")).toBe(true);
  });
});
