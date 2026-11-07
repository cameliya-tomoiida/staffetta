"use client";
// 全画面の上の「AI に頼む」（作者 11/6 (25)(33)）。押すと右下に窓が開く。
// 使い方を聞くだけでなく、注文を入れる・探す・製造計画や粗利を答える・取引先を登録する（OK を押してから）などを頼める。
// いま見ている画面の中身（文字）も一緒に送るので、「この注文が要確認になった理由は？」のような頼み方もできる。
import { AiThinking } from "@/components/ui/ComputeShow";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "@/components/ui/Link";
import { usePathname, useRouter } from "next/navigation";
import { askAiAction, chatLogAction, clearChatAction, confirmAgentAction } from "@/app/ai/actions";
import type { AgentMessage } from "@/lib/ai/agent";

const EXAMPLES = ["来週月曜、C03 にバターロール50個追加", "今月の粗利が下がった取引先は？", "明日の製造の数は？", "この画面は何をするところ？"];

export function AiChat({ floating = false }: { floating?: boolean } = {}) {
  const path = usePathname() ?? "/";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<AgentMessage[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<Record<string, string>>({}); // OK を押した結果（id → 文）
  // スマホの浮いた AI ボタンは、画面を動かしている間は隠す（注文のカードに重なって読めない。管理役2 11/7）
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    if (!floating) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = () => {
      setMoving(true);
      clearTimeout(t);
      t = setTimeout(() => setMoving(false), 700);
    };
    window.addEventListener("scroll", on, { passive: true });
    return () => {
      window.removeEventListener("scroll", on);
      clearTimeout(t);
    };
  }, [floating]);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && list == null) chatLogAction().then(setList).catch(() => setList([]));
  }, [open, list]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [list, pending, open]);
  // ⑧ ホームの確認の行の［直す］: 「hub:ai-ask」（detail: { text }）で窓を開き、文を入れておく（送るのは人）
  useEffect(() => {
    const on = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text ?? "";
      setOpen(true);
      if (text) setQ(text);
    };
    window.addEventListener("hub:ai-ask", on);
    return () => window.removeEventListener("hub:ai-ask", on);
  }, []);

  const ask = (text: string) => {
    const question = text.trim();
    if (!question) return;
    setError("");
    setQ("");
    setList((l) => [...(l ?? []), { role: "user", text: question, at: new Date().toISOString(), path }]);
    const main = document.querySelector("main") as HTMLElement | null;
    // 画面が表示している日・タブ（管理役2 11/7: 画面は明日を出しているのに、AI が今日の数で答えて「差がある」と言った）
    const shown = document.querySelector("[data-screen-date]");
    const screen = shown ? `【画面が表示している日】${shown.getAttribute("data-screen-date")}${shown.getAttribute("data-screen-tab") ? `（タブ: ${shown.getAttribute("data-screen-tab")}）` : ""}\n` : "";
    const pageText = screen + (main?.innerText ?? "");
    start(async () => {
      const r = await askAiAction(question, path + window.location.search, pageText);
      if (r.ok) {
        setList((l) => [...(l ?? []), r.message]);
        if (r.message.did?.length) router.refresh();
      } else setError(r.error);
    });
  };
  const ok = (id: string) =>
    start(async () => {
      const r = await confirmAgentAction(id);
      setDone((d) => ({ ...d, [id]: r.ok ? `✓ ${r.text}` : `できませんでした：${r.error}` }));
      if (r.ok) router.refresh();
    });

  return (
    <div className="no-print">
      {!open && (
        // 上の行（日付の横）に置く。画面の右下に浮かせると、保存などのボタンに重なるため
        floating ? (
          <button type="button" onClick={() => setOpen(true)} aria-label="AI に頼む"
            className={`fixed right-3 z-30 grid h-12 w-12 place-items-center rounded-full bg-[#8b1a1a] text-[15px] font-black text-white shadow-[0_6px_18px_rgb(0_0_0/0.35)] transition duration-200 active:scale-95 ${moving ? "pointer-events-none translate-x-20 opacity-0" : ""}`}
            style={{ bottom: "calc(env(safe-area-inset-bottom) + 76px)" }}>
            AI
          </button>
        ) : (
        <button type="button" onClick={() => setOpen(true)}
          className="flex min-h-11 items-center gap-1.5 rounded-full bg-[#8b1a1a] px-4 text-[17px] font-bold whitespace-nowrap text-white hover:bg-[#701414] max-md:min-h-9 max-md:gap-1 max-md:px-2.5 max-md:text-[14px]">
          <svg viewBox="0 0 24 24" className="h-6 w-6 max-md:hidden" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 5h16v11H9l-5 4Z" />
            <path d="M9 9.5h6M9 12.5h4" />
          </svg>
          AI<span className="max-md:hidden"> に頼む</span>
        </button>
        )
      )}
      {open && typeof document !== "undefined" && createPortal(
        <div role="dialog" aria-label="AI に頼む" className="m-sheet fixed right-4 bottom-4 z-50 flex h-[min(680px,calc(100dvh-2rem))] w-[min(460px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border-2 border-rule-strong bg-sheet shadow-2xl max-md:inset-0 max-md:h-dvh max-md:w-full max-md:rounded-none max-md:border-0 max-md:pt-[env(safe-area-inset-top)] max-md:pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-center gap-2 border-b border-rule bg-[#8b1a1a] px-4 py-2 text-white">
            <span className="text-[19px] font-black">AI に頼む</span>
            <span className="text-[15px] opacity-80">頼みごと・使い方</span>
            <span className="ml-auto" />
            {list && list.length > 0 && (
              <button type="button" className="min-h-11 px-2 text-[15px] underline" onClick={() => start(async () => { await clearChatAction(); setList([]); })}>消す</button>
            )}
            <button type="button" className="min-h-11 px-2 text-[16px] font-bold underline" onClick={() => setOpen(false)}>閉じる</button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-[17px]">
            {list?.length === 0 && (
              <div>
                <p className="text-ink-soft">注文を入れる・探す・数字を答える・使い方の説明などを頼めます。送る・お金・消すことは、人がボタンを押します。たとえば:</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {EXAMPLES.map((e) => (
                    <button key={e} type="button" onClick={() => ask(e)} className="min-h-11 rounded-full border-2 border-rule-strong bg-sheet px-3 text-left text-[16px] hover:border-crust-500">{e}</button>
                  ))}
                </div>
              </div>
            )}
            {list?.map((m, i) => (
              <div key={i} className={m.role === "user" ? "ml-8 rounded-xl bg-[#fcf0f0] px-3 py-2" : "mr-4 rounded-xl border border-rule bg-cream px-3 py-2"}>
                <div className="whitespace-pre-wrap">{m.text}</div>
                {m.did && m.did.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {m.did.map((d, k) => <li key={k} className="rounded-lg bg-ok-bg px-2 py-1 text-[16px] font-bold text-ok-ink">✓ {d}</li>)}
                  </ul>
                )}
                {m.pending?.map((p) => (
                  <div key={p.id} className="mt-2 rounded-lg border-2 border-[#b08210] bg-[#fff3c4] px-3 py-2">
                    <div className="text-[16px] font-bold text-[#654700]">OK を押すと実行します</div>
                    <div className="text-[16px]">{p.summary}</div>
                    {done[p.id] ? (
                      <div className="mt-1 text-[16px] font-bold">{done[p.id]}</div>
                    ) : (
                      <div className="mt-2 flex gap-2">
                        <button type="button" disabled={pending} onClick={() => ok(p.id)} className="min-h-11 rounded-lg bg-[#8b1a1a] px-4 text-[16px] font-bold text-white">OK</button>
                        <button type="button" onClick={() => setDone((d) => ({ ...d, [p.id]: "やめました" }))} className="min-h-11 rounded-lg border-2 border-rule-strong bg-sheet px-4 text-[16px]">やめる</button>
                      </div>
                    )}
                  </div>
                ))}
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
            {pending && <AiThinking title="AI が調べています" />}
            {error && <div role="alert" className="rounded-xl bg-[#fff0f1] px-3 py-2 font-bold text-[#a51e28]">{error}</div>}
            <div ref={end} />
          </div>
          <form className="flex gap-2 border-t border-rule p-3" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ここに書いて「頼む」" aria-label="頼みたいこと" maxLength={1500}
              className="min-h-12 min-w-0 flex-1 rounded-lg border-2 border-rule-strong px-3 text-[17px]" />
            <button disabled={pending || !q.trim()} className="min-h-12 rounded-lg bg-[#8b1a1a] px-4 text-[17px] font-bold text-white disabled:bg-[#c5cac5]">頼む</button>
          </form>
        </div>,
        document.body,
      )}
    </div>
  );
}
