// 審査員向けの見本の公開の期限（11/8 担当者: DEMO_PUBLIC_UNTIL・既定 11/11 23:59:59）
import { afterEach, describe, expect, it } from "vitest";
import { demoPublicClosed, demoPublicUntilLabel } from "../data-dir";

afterEach(() => {
  delete process.env.HUB_DEMO;
  delete process.env.DEMO_PUBLIC_UNTIL;
});

describe("見本の公開の期限", () => {
  it("見本でなければ、いつでも閉じない（本番 3100）", () => {
    expect(demoPublicClosed(Date.parse("2027-01-01T00:00:00+09:00"))).toBe(false);
  });
  it("見本は 11/11 の終わりまで開いていて、そのあと閉じる", () => {
    process.env.HUB_DEMO = "1";
    expect(demoPublicClosed(Date.parse("2026-11-11T23:59:00+09:00"))).toBe(false);
    expect(demoPublicClosed(Date.parse("2026-11-12T00:00:01+09:00"))).toBe(true);
    expect(demoPublicUntilLabel()).toBe("11/11");
  });
  it(".env の DEMO_PUBLIC_UNTIL で変えられる", () => {
    process.env.HUB_DEMO = "1";
    process.env.DEMO_PUBLIC_UNTIL = "2026-11-20T23:59:59+09:00";
    expect(demoPublicClosed(Date.parse("2026-11-15T00:00:00+09:00"))).toBe(false);
    expect(demoPublicUntilLabel()).toBe("11/20");
  });
});
