"use client";
// お知らせを送る（人が OK を押したときだけ）と、FAX・手渡しの「送った」の記録
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useStaffNames } from "@/components/ui/staff";
import { markDeliveredAction, sendNoticeAction } from "../actions";

export function NoticeSend({ id, status, counts, faxLeft, locked }: { id: string; status: "draft" | "sent"; counts: { line: number; fax: number; none: number }; faxLeft: number; locked?: boolean }) {
  const router = useRouter();
  const staff = useStaffNames();
  const [who, setWho] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [pending, start] = useTransition();
  const send = () => {
    if (!window.confirm(locked ? "いまは送信の鍵が OFF です。本物のお客さんには送らず、「送っていない」と記録します（見本の取引先の LINE にだけ試しに送ります）。よろしいですか？" : `この内容で送ります（LINE ${counts.line}件・FAX ${counts.fax}件・手渡し ${counts.none}件）。よろしいですか？`)) return;
    start(async () => {
      const r = await sendNoticeAction(id, who);
      setMsg(r.ok ? { ok: true, text: locked ? `試しの状態なので、本物のお客さんには送っていません（見本の LINE ${r.sent}件だけ）。` : `送りました（LINE ${r.sent}件）。FAX ${r.fax}件は印刷して送ってください。` } : { ok: false, text: r.error });
      router.refresh();
    });
  };
  const delivered = () => start(async () => {
    const r = await markDeliveredAction(id, "", who);
    setMsg(r.ok ? { ok: true, text: "FAX・手渡しを「送った」にしました" } : { ok: false, text: r.error });
    router.refresh();
  });
  return (
    <section className="card flex flex-wrap items-end gap-3 p-4">
      <label className="space-y-1">
        <span className="block text-base font-bold text-ink-soft">{status === "draft" ? "OK を押す人" : "送った人"}</span>
        <select value={who} onChange={(e) => setWho(e.target.value)} className="min-h-14 w-48 rounded-lg border-2 border-rule-strong bg-sheet px-3 text-lg">
          <option value="">えらぶ</option>
          {staff.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      {status === "draft" ? (
        <button type="button" onClick={send} disabled={pending || !who} className="btn-primary text-lg">{locked ? "OK（試し・本物には送らない）" : `OK・この内容で送る（LINE ${counts.line}・FAX ${counts.fax}・手渡し ${counts.none}）`}</button>
      ) : (
        <>
          <a href={`/notices/${id}/print`} className="btn-ghost text-lg">FAX・手渡しの紙を印刷（{faxLeft}件）</a>
          <button type="button" onClick={delivered} disabled={pending || !who || faxLeft === 0 || locked} className="btn-primary text-lg">FAX・手渡しを全部「送った」にする</button>
        </>
      )}
      {msg && <p role="status" className={`w-full text-lg font-bold ${msg.ok ? "text-ok-ink" : "text-alert-ink"}`}>{msg.text}</p>}
    </section>
  );
}
