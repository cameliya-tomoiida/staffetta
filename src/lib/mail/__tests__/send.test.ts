import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/sqlite";
import { setFlag } from "@/lib/settings/features";
import { canSendTo, mailLog, sendMail, setTestAddresses } from "../send";
import { mailStatus } from "../graph";
import { channelFor } from "@/lib/notices/plan";

describe("メールを送る部品", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM kv WHERE key IN ('mail_log','mail_test_to','mail_graph') OR key LIKE 'feature_flags%'");
    setFlag("notice_send", false, "テスト");
  });

  it("送信の鍵が OFF のあいだは、試しに送れる宛先（自分のアドレス）にだけ送れる", () => {
    setTestAddresses(["me@example.com"]);
    expect(canSendTo(["me@example.com"])).toEqual({ ok: true });
    expect(canSendTo(["customer@example.com"]).ok).toBe(false);
    expect(canSendTo(["ME@example.com", "customer@example.com"]).ok).toBe(false);
    setFlag("notice_send", true, "テスト");
    expect(canSendTo(["customer@example.com"])).toEqual({ ok: true });
    expect(() => setTestAddresses(["not-an-address"])).toThrow(/形が違います/);
  });

  it("つながっていないときは送らずに止めて、記録だけ残す（パスワードの欄は無い）", async () => {
    setTestAddresses(["me@example.com"]);
    expect(mailStatus().connected).toBe(false);
    const r = await sendMail({ to: ["me@example.com"], subject: "試し", body: "本文" }, "たなか");
    expect(r).toMatchObject({ ok: false, via: "held" });
    expect(r.error).toMatch(/つながっていません/);
    const held = await sendMail({ to: ["customer@example.com"], subject: "試し", body: "本文" }, "たなか");
    expect(held.error).toMatch(/試しの状態/);
    expect(mailLog()).toHaveLength(2);
    await expect(sendMail({ to: ["me@example.com"], subject: "s", body: "b" }, "")).rejects.toThrow(/送る人/);
  });

  it("お知らせの送り方: LINE → メール → FAX → 手渡し", () => {
    expect(channelFor({ fax: "000-1", email: "a@example.com" }, ["U1"]).channel).toBe("line");
    expect(channelFor({ fax: "000-1", email: "a@example.com" }, [])).toEqual({ channel: "email", to: ["a@example.com"] });
    expect(channelFor({ fax: "000-1" }, []).channel).toBe("fax");
  });
});
