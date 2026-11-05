"use client";
// 確定・仮発注の注文に「返事を作る」（⑤）。取引先の入口に合わせて、返信用 FAX の PDF か返信メールの下書きを作り、
// /outbound の「返事の送信待ち」に並べる。送るのは人。
import Link from "next/link";
import { useState, useTransition } from "react";
import { Button, Notice } from "@/components/ui";
import { createReplyAction } from "./reply-actions";

export function ReplyButton({ orderId, who }: { orderId: string; who: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const make = () =>
    start(async () => {
      const r = await createReplyAction(orderId, who);
      setMsg(
        r.ok
          ? { ok: true, text: `${r.kind === "fax" ? "返信用 FAX" : "返信メール"}の下書きを作りました${r.late ? `（間に合わない品 ${r.late}）` : ""}${r.changed ? `（変更 ${r.changed}）` : ""}。` }
          : { ok: false, text: r.error },
      );
    });
  return (
    <div className="space-y-1">
      <Button disabled={pending || !who} onClick={make} title={who ? undefined : "上で担当する人をえらんでください"}>
        返事を作る
      </Button>
      {msg && (
        <Notice tone={msg.ok ? "ok" : "alert"}>
          {msg.text}
          {msg.ok && <> <Link className="underline" href="/outbound#replies">送り出しで確かめて送る</Link></>}
        </Notice>
      )}
    </div>
  );
}
