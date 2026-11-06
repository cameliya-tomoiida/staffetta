"use client";
// コースの見直しの AI（⑦の(29)）: 条件の一覧（メモを AI に読ませる・on/off・消す）と、AI と話して計算し直すチャット。
import { MIcon } from "@/components/ui/MobileNav";
import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { buttonClass } from "@/components/ui";
import { ruleText, type RouteRule } from "@/lib/routes/ai-rules";
import { readNotesAction, saveRouteRulesAction } from "./actions";

type Rec = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: () => void };
const speechCtor = (): (new () => Rec) | undefined => {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

/** 条件の一覧。この曜日の先に関わる条件と、先に関わらない条件（帰る時刻）を出す */
export function RulesBox({
  rules, setRules, ids, nameOf, hasAi, skipped,
}: { rules: RouteRule[]; setRules: (r: RouteRule[]) => void; ids: string[]; nameOf: (id: string) => string; hasAi: boolean; skipped: string[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string; warn?: string[] } | null>(null);
  const here = new Set(ids);
  const shown = rules.filter((r) => !r.customerIds.length || r.customerIds.some((id) => here.has(id)));
  const calc = shown.filter((r) => r.kind !== "info");
  const info = shown.filter((r) => r.kind === "info");
  const save = (next: RouteRule[]) => {
    setRules(next);
    void saveRouteRulesAction(next);
  };
  const read = () =>
    start(async () => {
      setMsg(null);
      const r = await readNotesAction(ids);
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setRules(r.rules);
      setMsg({ ok: true, text: r.read ? `${r.read}件のメモを読みました。条件を見て、使わないものは外してください。` : "メモの入っている先がありませんでした。", warn: r.warnings });
    });
  const row = (r: RouteRule) => (
    <li key={r.id} className={`flex flex-wrap items-center gap-3 rounded-lg border-2 p-2 ${r.on ? "border-rule-strong bg-sheet" : "border-rule bg-off-bg/60 text-ink-soft"}`}>
      <label className="flex min-h-12 cursor-pointer items-center gap-2 text-lg">
        <input type="checkbox" className="size-6" checked={r.on} onChange={() => save(rules.map((x) => (x.id === r.id ? { ...x, on: !x.on } : x)))} />
        <span className={r.on ? "font-bold" : "line-through"}>{ruleText(r, nameOf)}</span>
      </label>
      <span className="text-base text-ink-soft">{r.source === "note" ? "メモから" : "話から"}: {r.why}</span>
      <button type="button" className={`${buttonClass("quiet", "md")} ml-auto`} onClick={() => save(rules.filter((x) => x.id !== r.id))} aria-label={`${ruleText(r, nameOf)} を消す`}>
        消す
      </button>
    </li>
  );
  return (
    <div className="space-y-3 rounded-lg border-2 border-rule p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-xl font-bold">計算の条件（AI）</h3>
        {hasAi ? (
          <button type="button" className={buttonClass("ghost", "md")} disabled={pending || !ids.length} onClick={read}>
            {pending ? "メモを読んでいます…" : "配送メモを AI に読ませる"}
          </button>
        ) : (
          <span className="text-base text-ink-soft">「設定 → AI」でキーを入れると、AI が配送メモを読んで条件にします。</span>
        )}
      </div>
      <p className="text-base text-ink-soft">取引先の「納品の仕方・注意事項・メモ」の「10時まで」「月曜休み」などを、計算の条件にします。チェックを外すと、その条件は使いません（取引先のマスタは変えません）。</p>
      {msg && <p className={`text-lg font-bold ${msg.ok ? "text-ok-ink" : "text-alert-ink"}`}>{msg.ok ? "" : "！ "}{msg.text}</p>}
      {msg?.warn?.map((w) => (
        <p key={w} className="text-base text-review-ink">！ {w}</p>
      ))}
      {calc.length > 0 ? <ul className="space-y-2">{calc.map((r) => row(r))}</ul> : <p className="text-lg">条件はまだありません。</p>}
      {skipped.length > 0 && <p className="text-lg">この曜日に回らない先（条件から）: {skipped.map(nameOf).join("・")}</p>}
      {info.length > 0 && (
        <details>
          <summary className="cursor-pointer text-lg">配る人へのメモ（計算には使わない）{info.length}件</summary>
          <ul className="mt-2 space-y-2">{info.map((r) => row(r))}</ul>
        </details>
      )}
    </div>
  );
}

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

/** AI と話して、条件・決まりを直して計算し直す */
export function RouteChat({ turns, pending, onSend }: { turns: Turn[]; pending: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const recRef = useRef<Rec | null>(null);
  const hasSpeech = useSyncExternalStore(
    () => () => {},
    () => !!speechCtor(),
    () => false,
  );
  const send = () => {
    const said = text.trim();
    if (!said) return;
    setText("");
    onSend(said);
  };
  const listen = () => {
    const Speech = speechCtor();
    if (!Speech) return;
    if (listening) return recRef.current?.stop();
    const rec = new Speech();
    rec.lang = "ja-JP";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => setText((x) => `${x}${Array.from(e.results).map((r) => r[0].transcript).join("")}`);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };
  return (
    <div className="space-y-3 rounded-lg border-2 border-rule p-4">
      <h3 className="text-xl font-bold">AI と相談して計算し直す</h3>
      <ol className="max-h-[50vh] space-y-2 overflow-y-auto">
        {turns.map((x, i) => (
          <li key={i} className={x.role === "user" ? "ml-8 rounded-lg bg-crust-50 p-2 text-lg" : "mr-8 rounded-lg bg-info-bg p-2 text-lg whitespace-pre-wrap text-info-ink"}>
            <span className="block text-sm font-bold">{x.role === "user" ? "あなた" : "AI"}</span>
            {x.text}
          </li>
        ))}
        {pending && <li className="mr-8 rounded-lg bg-info-bg p-2 text-lg text-info-ink">AI が考えています…</li>}
      </ol>
      <textarea
        rows={2}
        className="w-full rounded-lg border-2 border-rule-strong bg-sheet p-2 text-lg"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="例: 〇〇さんは11時までに帰りたい ／ 3コースにして ／ この2つの先は同じコースに"
        aria-label="AI に話す"
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass("primary", "md")} disabled={pending || !text.trim()} onClick={send}>
          送る
        </button>
        {hasSpeech && (
          <button type="button" className={buttonClass(listening ? "primary" : "ghost", "md")} onClick={listen} aria-pressed={listening}>
            {listening ? "● 聞いています" : <span className="inline-flex items-center gap-1"><MIcon name="mic" className="h-5 w-5" />声で話す</span>}
          </button>
        )}
      </div>
    </div>
  );
}
