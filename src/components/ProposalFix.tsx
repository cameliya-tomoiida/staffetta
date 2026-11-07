"use client";
// AI の案を見て、OK するか、言葉で直す（作者 11/7 担当者「修正が必要なら、それを伝えて AI が直す。アプリ上でやりたい」）。
// 中身 → ［OK］（そのまま実行）／ 言葉（音声でも）で伝える → AI が直す →「こう直しました。よろしいですか？」［OK］［さらに直す］
// ホームの確認の行（⑧）からも、/proposals/<id> の画面からも使う。
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useStaffNames } from "@/components/ui/staff";
import { approveProposalAction, getProposalAction, reviseProposalAction, type ProposalView } from "@/app/proposals/actions";

type SR = { lang: string; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; start: () => void; stop: () => void };

export function ProposalFix({ proposalId, onClose }: { proposalId: string; onClose?: () => void }) {
  const router = useRouter();
  const staff = useStaffNames();
  const [v, setV] = useState<ProposalView | null>(null);
  const [who, setWho] = useState("");
  const [text, setText] = useState("");
  const [talk, setTalk] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; href?: string }>();
  const [pending, start] = useTransition();
  const [listening, setListening] = useState(false);
  const rec = useRef<SR | null>(null);

  useEffect(() => {
    let live = true;
    getProposalAction(proposalId).then((x) => live && setV(x));
    return () => {
      live = false;
    };
  }, [proposalId]);

  const ok = () =>
    start(async () => {
      const r = await approveProposalAction(proposalId, who);
      if (r.ok) {
        setV(r.view);
        setMsg({ ok: true, text: r.message ?? "OK しました", href: r.href });
        router.refresh();
        onClose?.();
      } else setMsg({ ok: false, text: r.error });
    });
  const fix = () =>
    start(async () => {
      const r = await reviseProposalAction(proposalId, text, who);
      if (r.ok) {
        setV(r.view);
        setText("");
        setTalk(false);
        setMsg(undefined);
        router.refresh();
      } else setMsg({ ok: false, text: r.error });
    });
  const mic = () => {
    const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const C = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!C) return setMsg({ ok: false, text: "この端末では音声入力が使えません（キーボードのマイクを使ってください）" });
    if (listening) return rec.current?.stop();
    const r = new C();
    r.lang = "ja-JP";
    r.interimResults = false;
    r.onresult = (e) => setText((t) => (t ? `${t} ` : "") + Array.from(e.results).map((x) => x[0].transcript).join(""));
    r.onend = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };

  if (!v) return <p className="p-4 text-ink-soft">読み込み中…</p>;
  const done = v.status !== "open";
  return (
    <section className="space-y-3 rounded-xl border-2 border-crust-600 bg-sheet p-4">
      <h2 className="text-lg leading-snug font-black">
        <span className="mr-1 rounded bg-crust-600 px-1.5 py-0.5 text-sm text-white">AI の案</span>
        {v.title}
      </h2>
      {v.note && <p className="-mt-2 text-base text-ink-soft">{v.note}</p>}
      <ul className="space-y-1 rounded-lg bg-cream p-3 text-[17px]">
        {v.lines.length === 0 && <li className="text-ink-soft">（することはありません）</li>}
        {v.lines.map((l, i) => (
          <li key={i}>・{l}</li>
        ))}
      </ul>
      {!done && (
        <div className="flex flex-wrap items-center gap-2">
          <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="確かめる人" className="min-h-12 rounded-lg border-2 border-rule-strong bg-sheet px-3 text-lg">
            <option value="">確かめる人</option>
            {staff.map((s) => <option key={s}>{s}</option>)}
          </select>
          <button type="button" className="btn-primary min-w-24 text-lg" disabled={pending || !who || v.lines.length === 0} onClick={ok}>
            OK
          </button>
          <button type="button" className="btn-ghost text-lg" disabled={pending} onClick={() => setTalk(!talk)}>
            {v.rev > 0 ? "さらに直す" : "直す"}
          </button>
        </div>
      )}
      {talk && !done && (
        <div className="space-y-2">
          <div className="flex items-end gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              placeholder="例: 黒糖は来週でいい／ピザ生地は先に"
              className="min-h-14 flex-1 rounded-lg border-2 border-rule-strong bg-sheet p-2 text-lg"
              aria-label="どう直すか"
            />
            <button type="button" onClick={mic} aria-label="声で入れる" className={`h-14 w-14 shrink-0 rounded-full border-2 text-2xl ${listening ? "border-[#d64545] bg-[#d64545] text-white" : "border-rule-strong"}`}>
              🎤
            </button>
          </div>
          <button type="button" className="btn-primary text-lg" disabled={pending || !text.trim() || !who} onClick={fix}>
            {pending ? "AI が直しています…" : "AI に直してもらう"}
          </button>
        </div>
      )}
      {done && <p className="font-bold text-ok-ink">この案は終わりました（{v.history.at(-1)?.who}）</p>}
      {msg && (
        <p role="status" className={`font-bold ${msg.ok ? "text-ok-ink" : "text-alert-ink"}`}>
          {msg.text}
          {msg.href && <a href={msg.href} className="ml-2 underline">開く ›</a>}
        </p>
      )}
      {v.history.length > 1 && (
        <details className="text-sm text-ink-soft">
          <summary className="cursor-pointer">記録（{v.history.length}）</summary>
          <ul className="mt-1 space-y-0.5">
            {v.history.map((h, i) => (
              <li key={i}>
                {new Date(h.at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} {h.who}：{h.what}
                {h.text && `「${h.text}」`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
