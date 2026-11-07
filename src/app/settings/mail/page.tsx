import { connection } from "next/server";
import { PageHeader } from "@/components/ui";
import { mailStatus } from "@/lib/mail/graph";
import { mailLog, testAddresses } from "@/lib/mail/send";
import { isOn } from "@/lib/settings/features";
import { MailClient } from "./MailClient";

export const metadata = { title: "メール送信｜設定" };

// メール送信（作者 11/7 担当者）: Microsoft でつなぐ（OAuth。パスワードの欄は作らない）・試しに送れる宛先・送った記録
export default async function MailSettingsPage(props: PageProps<"/settings/mail">) {
  await connection();
  const q = await props.searchParams;
  const st = mailStatus();
  return (
    <div className="space-y-5">
      <PageHeader title="メール送信" lead="" />
      <MailClient
        status={st}
        unlocked={isOn("notice_send")}
        testTo={testAddresses()}
        log={mailLog().slice(0, 20)}
        flash={typeof q.ok === "string" ? { ok: true, text: "つなぎました" } : typeof q.error === "string" ? { ok: false, text: q.error } : undefined}
      />
    </div>
  );
}
