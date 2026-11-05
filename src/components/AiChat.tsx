"use client";
// 全画面の右下の「AI に聞く」（作者 11/6 (25)）。アプリの使い方・困りごとを聞くと、答えと、必要ならその画面へのボタンを出す。
// いま見ている画面の中身（文字）も一緒に送るので、「この注文が要確認になった理由は？」のような聞き方ができる。
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { askAiAction, chatLogAction, clearChatAction } from "@/app/ai/actions";
import type { ChatMessage } from "@/lib/ai/chat";

const EXAMPLES = ["この画面は何をするところ？", "注文が要確認になるのはどんなとき？", "スタッフを増やしたい", "AI の使った量はどこで見る？"];

export function AiChat() {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ChatMessage[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && list == null) chatLogAction().then(setList).catch(() => setList([]));
  }, [open, list]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [list, pending, open]);

  const ask = (text: string) => {
    const question = text.trim();
    if (!question) return;
    setError("");
    setQ("");
    const mine: ChatMessage = { role: "user", text: question, at: new Date().toISOString(), path };
    setList((l) => [...(l ?? []), mine]);
    const pageText = (document.querySelector("main") as HTMLElement | null)?.innerText ?? "";
    start(async () => {
      const r = await askAiAction(question, path, pageText);
      if (r.ok) setList((l) => [...(l ?? []), r.message]);
      else setError(r.error);
    });
  };

  return (
    <div className="no-print">
      {!open && (
        <button type="button" onClick={() => setOpen(true)}
          className="fixed right-4 bottom-4 z-30 flex min-h-14 items-center gap-2 rounded-full bg-[#8b1a1a] px-5 text-[18px] font-bold text-white shadow-lg hover:bg-[#701414]">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 5h16v11H9l-5 4Z" />
            <path d="M9 9.5h6M9 12.5h4" />
          </svg>
          AI に聞く
        </button>
      )}
      {open && (
        <div role="dialog" aria-label="AI に聞く" className="fixed right-4 bottom-4 z-50 flex h-[min(640px,calc(100dvh-2rem))] w-[min(440px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border-2 border-rule-strong bg-sheet shadow-2xl">
          <div className="flex items-center gap-2 border-b border-rule bg-[#8b1a1a] px-4 py-2 text-white">
            <span className="text-[19px] font-black">AI に聞く</span>
            <span className="text-[15px] opacity-80">アプリの使い方・困りごと</span>
            <span className="ml-auto" />
            {list && list.length > 0 && (
              <button type="button" className="min-h-11 px-2 text-[15px] underline" onClick={() => start(async () => { await clearChatAction(); setList([]); })}>消す</button>
            )}
            <button type="button" className="min-h-11 px-2 text-[16px] font-bold underline" onClick={() => setOpen(false)}>閉じる</button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-[17px]">
            {list?.length === 0 && (
              <div>
                <p className="text-ink-soft">いま見ている画面のことも聞けます。たとえば:</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {EXAMPLES.map((e) => (
                    <button key={e} type="button" onClick={() => ask(e)} className="min-h-11 rounded-full border-2 border-rule-strong bg-sheet px-3 text-[16px] hover:border-crust-500">{e}</button>
                  ))}
                </div>
              </div>
            )}
            {list?.map((m, i) => (
              <div key={i} className={m.role === "user" ? "ml-8 rounded-xl bg-[#faf1f1] px-3 py-2" : "mr-4 rounded-xl border border-rule bg-cream px-3 py-2"}>
                <div className="whitespace-pre-wrap">{m.text}</div>
                {m.links && m.links.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {m.links.map((l) => (
                      <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="inline-flex min-h-11 items-center rounded-lg bg-[#8b1a1a] px-3 text-[16px] font-bold text-white">
                        {l.label} ›
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {pending && <div className="mr-4 rounded-xl border border-rule bg-cream px-3 py-2 text-ink-soft">考えています…</div>}
            {error && <div role="alert" className="rounded-xl bg-[#fff0f1] px-3 py-2 font-bold text-[#a51e28]">{error}</div>}
            <div ref={end} />
          </div>
          <form className="flex gap-2 border-t border-rule p-3" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ここに書いて「聞く」" aria-label="聞きたいこと" maxLength={1000}
              className="min-h-12 min-w-0 flex-1 rounded-lg border-2 border-rule-strong px-3 text-[17px]" />
            <button disabled={pending || !q.trim()} className="min-h-12 rounded-lg bg-[#8b1a1a] px-4 text-[17px] font-bold text-white disabled:bg-[#c5cac5]">聞く</button>
          </form>
        </div>
      )}
    </div>
  );
}
