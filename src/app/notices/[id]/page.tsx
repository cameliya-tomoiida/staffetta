import { LockBanner } from "../LockBanner";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NOTICE_KIND_LABEL } from "@/lib/notices/plan";
import { getNotice, sendUnlocked } from "@/lib/notices/store";
import { NoticeSend } from "./NoticeSend";

export const dynamic = "force-dynamic";

const CH: Record<string, string> = { line: "LINE", fax: "FAX", none: "手渡し" };
const ST: Record<string, string> = { waiting: "まだ", sent: "送った", fax_ready: "FAX を送る用意", failed: "送れなかった", hand: "手渡しする", held: "送っていない（送信の鍵が OFF）" };
const dt = (iso?: string) => (iso ? new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

// お知らせの中身・送る先・送った記録（作者 11/6 メモの 5）。下書きなら「この内容で送る」、送ったあとは FAX の印刷と「送った」の記録
export default async function NoticePage(props: PageProps<"/notices/[id]">) {
  const { id } = await props.params;
  const n = getNotice(id);
  if (!n) notFound();
  const count = (c: string) => n.recipients.filter((r) => r.channel === c).length;
  const faxLeft = n.recipients.filter((r) => r.status === "fax_ready" || r.status === "hand" || (r.status === "held" && r.channel !== "line")).length;
  return (
    <main className="space-y-5">
      <header className="space-y-2">
        <p><Link href="/notices" className="text-lg">← お知らせにもどる</Link></p>
        {!sendUnlocked() && (
          <LockBanner />
        )}
        <h1 className="text-3xl font-bold">{n.draft.title}</h1>
        <p className="text-lg text-ink-soft">
          {NOTICE_KIND_LABEL[n.input.kind]}・作った人 {n.createdBy}・{n.draftBy === "AI" ? "AI の下書きを直したもの" : "決まりの文"}
          {n.status === "sent" ? `・${dt(n.approvedAt)} に ${n.approvedBy} が OK して送りました` : "・まだ送っていません"}
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-2 p-4">
          <h2 className="text-xl font-bold">FAX・紙の文</h2>
          <pre className="font-sans text-lg leading-relaxed whitespace-pre-wrap">{n.draft.body}</pre>
        </div>
        <div className="card space-y-2 p-4">
          <h2 className="text-xl font-bold">LINE の文</h2>
          <pre className="font-sans text-lg leading-relaxed whitespace-pre-wrap">{n.draft.line}</pre>
        </div>
      </section>

      <NoticeSend locked={!sendUnlocked()} id={n.id} status={n.status} counts={{ line: count("line"), fax: count("fax"), none: count("none") }} faxLeft={faxLeft} />

      <section className="card p-0">
        <h2 className="border-b-2 border-rule-strong px-4 py-3 text-2xl font-bold">送る先（{n.recipients.length}件）</h2>
        <ul>
          {n.recipients.map((r) => (
            <li key={r.customerId} className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 border-b border-rule px-4 py-2 text-lg last:border-b-0">
              <span className="font-bold">{r.name}</span>
              <span className="text-ink-soft">{CH[r.channel]}{r.channel === "fax" ? ` ${r.to.join("・")}` : ""}</span>
              <span className={`ml-auto pill text-base ${r.status === "sent" ? "border-ok-line text-ok-ink" : r.status === "failed" ? "border-alert-line text-alert-ink" : "border-rule-strong"}`}>
                {ST[r.status]}{r.demo ? "（記録だけ・LINE は本番ではない）" : ""}{r.at ? ` ${dt(r.at)}` : ""}{r.by ? ` ${r.by}` : ""}
              </span>
              {r.error && <span className="w-full text-base text-alert-ink">{r.error}</span>}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
