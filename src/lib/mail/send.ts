// メールを送る部品（作者 11/7 担当者）。送り主・宛先・件名・本文・添付 PDF → 送る → 送った記録。
// 送り方は Microsoft Graph（OAuth・Mail.Send。「設定 → メール送信」の「Microsoft でつなぐ」）。パスワードの欄は作らない。
// 送信の鍵（notice_send）が OFF のあいだは、「試しに送れる宛先」（設定で入れる自分のアドレス）にだけ送る。
// つながっていないときは送らずに止める（下書きと確かめ画面までは動く）。SMTP は予備（まだ作らない）。
import "server-only";
import { kvGet, kvSet } from "@/lib/db/sqlite";
import { nowIso } from "@/lib/clock";
import { isOn } from "@/lib/settings/features";
import { graphToken, mailStatus } from "./graph";

export interface MailInput {
  to: string[];
  subject: string;
  body: string;
  attachments?: { name: string; contentType: string; base64: string }[];
}

export interface MailLog { at: string; who: string; to: string[]; subject: string; ok: boolean; error?: string; via: "graph" | "held" }

const LOG = "mail_log";
const TEST_TO = "mail_test_to";
export const mailLog = (): MailLog[] => kvGet<MailLog[]>(LOG) ?? [];
const log = (x: MailLog) => kvSet(LOG, [x, ...mailLog()].slice(0, 200));

/** 鍵が OFF のあいだに、試しに送れる宛先（自分のアドレス。設定で入れる） */
export const testAddresses = (): string[] => kvGet<string[]>(TEST_TO) ?? [];
export function setTestAddresses(list: string[]) {
  const ok = list.map((x) => x.trim()).filter(Boolean);
  for (const a of ok) if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a)) throw new Error(`メールアドレスの形が違います: ${a}`);
  kvSet(TEST_TO, ok.slice(0, 5));
}

/** いま、この宛先に本当に送れるか（鍵・試しの宛先） */
export function canSendTo(to: string[]): { ok: true } | { ok: false; reason: string } {
  if (!to.length) return { ok: false, reason: "宛先がありません" };
  if (isOn("notice_send")) return { ok: true };
  const t = new Set(testAddresses().map((x) => x.toLowerCase()));
  return to.every((x) => t.has(x.toLowerCase())) ? { ok: true } : { ok: false, reason: "試しの状態なので、自分のアドレスにだけ送れます" };
}

/** 送る（Graph）。送れない理由があれば止めて、記録だけ残す */
export async function sendMail(m: MailInput, who: string): Promise<MailLog> {
  if (!who.trim()) throw new Error("送る人を選んでください");
  const at = nowIso();
  const gate = canSendTo(m.to);
  if (!gate.ok) {
    const r: MailLog = { at, who, to: m.to, subject: m.subject, ok: false, error: gate.reason, via: "held" };
    log(r);
    return r;
  }
  const st = mailStatus();
  if (!st.connected) {
    const r: MailLog = { at, who, to: m.to, subject: m.subject, ok: false, error: "メールがつながっていません（設定 → メール送信）", via: "held" };
    log(r);
    return r;
  }
  try {
    const token = await graphToken();
    const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: m.subject,
          body: { contentType: "Text", content: m.body },
          toRecipients: m.to.map((address) => ({ emailAddress: { address } })),
          attachments: (m.attachments ?? []).map((a) => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: a.name, contentType: a.contentType, contentBytes: a.base64 })),
        },
        saveToSentItems: true,
      }),
    });
    const r: MailLog = res.ok ? { at, who, to: m.to, subject: m.subject, ok: true, via: "graph" } : { at, who, to: m.to, subject: m.subject, ok: false, error: `送れませんでした（${res.status}）`, via: "graph" };
    log(r);
    return r;
  } catch (e) {
    const r: MailLog = { at, who, to: m.to, subject: m.subject, ok: false, error: e instanceof Error ? e.message : String(e), via: "graph" };
    log(r);
    return r;
  }
}
