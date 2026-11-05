"use client";
// AI とのチャットで衛生チェックシートを作る（⑦の(24)）。左＝会話（文章・声）、右＝いまの下書きの印刷の見本。
// 「登録する」で衛生管理のシートとして保存する（同じ ID なら置きかえ）。
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { buttonClass } from "@/components/ui";
import { FREQ_LABEL, KIND_LABEL, WD, type SheetDef } from "@/lib/hygiene/sheets";
import { chatSheetAction, registerSheetAction } from "../actions";

type Turn = { role: "user" | "assistant"; text: string; suggestions?: string[] };

// ブラウザの音声入力（Chrome・Edge）。無いブラウザではボタンを出さない
type Rec = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: () => void };
const speechCtor = (): (new () => Rec) | undefined => {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

export function SheetChat({ initial }: { initial?: SheetDef }) {
  const router = useRouter();
  const [id] = useState(() => initial?.id ?? `ai-${Date.now().toString(36)}`);
  const [draft, setDraft] = useState<SheetDef | undefined>(initial);
  const [turns, setTurns] = useState<Turn[]>(() =>
    initial ? [{ role: "assistant", text: `「${initial.title}」を直します。変えたい所を話してください（例：「金曜は書かない」「項目に〇〇を足して」）。` }] : [{ role: "assistant", text: "どんなチェックシートを作りますか？ 場所・何を見るか・回数・基準を話してください。" }],
  );
  const [text, setText] = useState("");
  const [warn, setWarn] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [listening, setListening] = useState(false);
  const recRef = useRef<Rec | null>(null);
  // 音声入力があるか（サーバーでは無い扱いにして、画面ができてから見る）
  const hasSpeech = useSyncExternalStore(
    () => () => {},
    () => !!speechCtor(),
    () => false,
  );

  const send = (t = text) => {
    const said = t.trim();
    if (!said) return;
    const next: Turn[] = [...turns, { role: "user", text: said }];
    setTurns(next);
    setText("");
    start(async () => {
      const r = await chatSheetAction(next.map(({ role, text: x }) => ({ role, text: x })), draft, id);
      if (!r.ok) {
        setTurns([...next, { role: "assistant", text: `（うまくいきませんでした: ${r.error}）` }]);
        return;
      }
      setDraft(r.def);
      setWarn(r.warnings);
      setTurns([...next, { role: "assistant", text: r.reply, suggestions: r.suggestions }]);
    });
  };
  const listen = () => {
    const Speech = speechCtor();
    if (!Speech) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new Speech();
    rec.lang = "ja-JP";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      const said = Array.from(e.results).map((r) => r[0].transcript).join("");
      setText((x) => (x ? `${x} ${said}` : said));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };
  const register = () =>
    start(async () => {
      if (!draft) return;
      const r = await registerSheetAction(draft);
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      router.push(`/hygiene/${r.id}`);
    });

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {/* 会話 */}
      <section className="flex flex-col gap-4">
        <ol className="card max-h-[60vh] space-y-3 overflow-y-auto p-4">
          {turns.map((t, i) => (
            <li key={i} className={t.role === "user" ? "ml-10 rounded-lg bg-crust-50 p-3 text-xl" : "mr-10 rounded-lg bg-info-bg p-3 text-xl text-info-ink"}>
              <span className="mb-1 block text-base font-bold">{t.role === "user" ? "あなた" : "AI"}</span>
              <span className="whitespace-pre-wrap">{t.text}</span>
              {t.suggestions?.length ? (
                <span className="mt-2 block border-t border-info-line pt-2 text-lg">
                  <b>提案（足りないかもしれない所）</b>
                  {t.suggestions.map((s) => (
                    <button key={s} type="button" disabled={pending} onClick={() => send(`提案の「${s}」を入れて`)} className="mt-1 block w-full rounded-md border-2 border-info-line bg-white px-3 py-2 text-left hover:border-info-ink">
                      ＋ {s}
                    </button>
                  ))}
                </span>
              ) : null}
            </li>
          ))}
          {pending && <li className="mr-10 rounded-lg bg-info-bg p-3 text-xl text-info-ink">AI が考えています…</li>}
        </ol>
        <div className="flex flex-col gap-2">
          <textarea
            rows={3}
            className="rounded-lg border-2 border-rule-strong bg-sheet p-3 text-xl"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
            }}
            placeholder="例：ピザの冷蔵庫、1日2回、5℃以下。外れたら責任者に知らせる"
            aria-label="AI に話す"
          />
          <div className="flex flex-wrap gap-3">
            <button type="button" className={buttonClass("primary", "lg")} disabled={pending || !text.trim()} onClick={() => send()}>
              送る
            </button>
            {hasSpeech && (
              <button type="button" className={buttonClass(listening ? "primary" : "ghost", "lg")} onClick={listen} aria-pressed={listening}>
                {listening ? "● 聞いています（押すと止める）" : "🎤 声で話す"}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* 下書きの見本 */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-bold">下書きの見本</h2>
          <button type="button" className={buttonClass("primary", "lg")} disabled={pending || !draft || warn.length > 0} onClick={register}>
            {initial ? "この内容で直す" : "登録する"}
          </button>
        </div>
        {msg && <p className={`rounded-md border-2 p-3 text-lg ${msg.ok ? "border-ok-line bg-ok-bg" : "border-alert-line bg-alert-bg text-alert-ink"}`}>{msg.text}</p>}
        {warn.map((w) => (
          <p key={w} className="rounded-md border-2 border-review-line bg-review-bg p-3 text-lg text-review-ink">！ {w}</p>
        ))}
        {draft ? <Preview def={draft} /> : <p className="card p-6 text-xl">まだ下書きはありません。左で話すと、ここに出ます。</p>}
      </section>
    </div>
  );
}

const B = "border border-black";
const TH = `${B} bg-[#ece6dc] px-1 text-left font-bold`;

/** 印刷の見本（はじめの1週間ぶん） */
function Preview({ def }: { def: SheetDef }) {
  const days = Array.from({ length: 7 }, (_, i) => i).filter((i) => !def.weekdays?.length || def.weekdays.includes(i));
  return (
    <div className="space-y-2 rounded-lg border-2 border-rule-strong bg-white p-4 text-black">
      <p className="text-base text-ink-soft">
        {KIND_LABEL[def.kind]}
        {def.area ? `・${def.area}` : ""}・{def.weekdays?.length ? `${def.weekdays.map((d) => WD[d]).join("")}曜` : "毎日"}
      </p>
      <h3 className="border-b-2 border-black pb-1 text-xl font-bold">{def.title}</h3>
      {def.rule && <p className="text-base">{def.rule}</p>}
      {def.kind === "temp" && def.temp && (
        <table className="w-full table-fixed border-collapse text-center text-sm">
          <thead>
            <tr>
              <th className={`${TH} w-20`}>{def.temp.unit}</th>
              {days.map((d) => (
                <th key={d} className={TH} colSpan={def.temp!.perDay}>{WD[d]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(def.temp.scale?.length ? def.temp.scale : ["数字"]).map((sv) => {
              const band = typeof sv === "number" && (def.temp!.min == null || sv >= def.temp!.min) && (def.temp!.max == null || sv <= def.temp!.max);
              return (
                <tr key={String(sv)}>
                  <th className={TH}>{sv}</th>
                  {days.flatMap((d) => Array.from({ length: def.temp!.perDay }, (_, k) => <td key={`${d}-${k}`} className={`${B} h-6 ${band ? "bg-[#e3e3e3]" : ""}`} />))}
                </tr>
              );
            })}
            {def.temp.humidity && (
              <tr>
                <th className={TH}>湿度%</th>
                {days.flatMap((d) => Array.from({ length: def.temp!.perDay }, (_, k) => <td key={`${d}-${k}`} className={`${B} h-6`} />))}
              </tr>
            )}
            <tr>
              <th className={TH}>措置</th>
              {days.map((d) => (
                <td key={d} className={`${B} h-8`} colSpan={def.temp!.perDay} />
              ))}
            </tr>
          </tbody>
        </table>
      )}
      {def.kind === "temp" && def.temp && (
        <p className="text-sm">
          {def.temp.set != null ? `設定 ${def.temp.set}${def.temp.unit}・` : ""}管理 {def.temp.min ?? ""}〜{def.temp.max ?? ""}{def.temp.unit}・1日 {def.temp.perDay}回
        </p>
      )}
      {(def.kind === "clean" || def.kind === "check") && (
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr>
              <th className={`${TH} w-[40%]`}>項目</th>
              <th className={`${TH} w-16`}>{def.kind === "clean" ? "頻度" : "数"}</th>
              {days.map((d) => (
                <th key={d} className={`${TH} text-center`}>{WD[d]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(def.items ?? []).map((it) => (
              <tr key={it.id}>
                <td className={`${B} px-1`}>
                  {it.group ? <b>【{it.group}】</b> : null}
                  {it.name}
                  {it.note ? <span className="block text-xs text-[#555]">{it.note}</span> : null}
                </td>
                <td className={`${B} px-1 text-xs`}>{def.kind === "clean" ? FREQ_LABEL[it.freq ?? "daily"] : (it.qty ?? "")}</td>
                {days.map((d) => (
                  <td key={d} className={`${B} h-7 text-center`}>{def.kind === "clean" && (it.freq ?? "daily") === "daily" ? "○" : ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {def.kind === "log" && (
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr>
              {(def.columns ?? []).map((c) => (
                <th key={c.key} className={`${TH} text-center`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2].map((r) => (
              <tr key={r}>
                {(def.columns ?? []).map((c) => (
                  <td key={c.key} className={`${B} h-8`} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {def.kind === "label" && <p className="border border-dashed border-black p-4 text-center text-lg">使用可能日 　月　　日</p>}
    </div>
  );
}
