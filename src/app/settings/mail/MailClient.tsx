"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useStaffNames } from "@/components/ui/staff";
import type { MailLog } from "@/lib/mail/send";
import { disconnectMailAction, saveTestAddressesAction, sendTestMailAction } from "./actions";

export function MailClient({ status, unlocked, testTo, log, flash }: { status: { configured: boolean; connected: boolean; account?: string }; unlocked: boolean; testTo: string[]; log: MailLog[]; flash?: { ok: boolean; text: string } }) {
  const router = useRouter();
  const staff = useStaffNames();
  const [who, setWho] = useState("");
  const [to, setTo] = useState(testTo.join(" "));
  const [msg, setMsg] = useState(flash);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: r.message ?? "できました" } : { ok: false, text: r.error });
      router.refresh();
    });
  const field = "min-h-12 rounded-lg border-2 border-rule-strong bg-sheet px-3 text-[18px]";
  return (
    <div className="space-y-4">
      <section className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-base font-black ${status.connected ? "bg-ok-bg text-ok-ink" : "bg-off-bg text-off-ink"}`}>{status.connected ? "つながっています" : "つながっていません"}</span>
          {status.account && <span className="text-lg">{status.account}</span>}
          {!unlocked && <span className="rounded bg-[#fff3c4] px-2 text-sm font-black text-[#654700] inline-flex items-center leading-none align-middle h-7">試しの状態：自分のアドレスにだけ送る</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {status.configured ? (
            <a href="/api/mail/oauth/start" className="btn-primary text-lg">{status.connected ? "つなぎ直す" : "Microsoft でつなぐ"}</a>
          ) : (
            <span className="text-base text-ink-soft">Azure のアプリの登録がまだです（MS_CLIENT_ID・MS_CLIENT_SECRET）</span>
          )}
          {status.connected && <button type="button" className="btn-ghost text-lg" disabled={pending} onClick={() => run(disconnectMailAction)}>外す</button>}
        </div>
      </section>
      <section className="card space-y-2 p-5">
        <label className="block text-[18px] font-bold">
          試しに送れる宛先
          <input className={`${field} mt-1 w-full font-normal`} value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@example.com" />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-ghost text-lg" disabled={pending} onClick={() => run(() => saveTestAddressesAction(to))}>保存</button>
          <select className={field} value={who} onChange={(e) => setWho(e.target.value)} aria-label="送る人">
            <option value="">送る人</option>
            {staff.map((s) => <option key={s}>{s}</option>)}
          </select>
          <button type="button" className="btn-primary text-lg" disabled={pending || !who || !testTo.length} onClick={() => run(() => sendTestMailAction(who))}>試しに1通送る</button>
        </div>
      </section>
      {msg && <p role="status" className={`text-lg font-bold ${msg.ok ? "text-ok-ink" : "text-alert-ink"}`}>{msg.text}</p>}
      {log.length > 0 && (
        <section className="card p-0">
          <h2 className="border-b border-rule px-4 py-2 text-lg font-bold">送った記録</h2>
          <ul>
            {log.map((x, i) => (
              <li key={i} className="flex flex-wrap gap-x-3 border-b border-rule px-4 py-2 text-base last:border-b-0">
                <span className={`font-bold ${x.ok ? "text-ok-ink" : "text-alert-ink"}`}>{x.ok ? "送った" : "送っていない"}</span>
                <span>{x.subject}</span>
                <span className="text-ink-soft">{x.to.join("・")}</span>
                <span className="num text-ink-soft">{new Date(x.at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} {x.who}</span>
                {x.error && <span className="w-full text-sm text-alert-ink">{x.error}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
