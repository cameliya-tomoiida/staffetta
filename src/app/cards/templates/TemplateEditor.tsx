"use client";
// 製品カードの形を「カードの見た目のまま」直す画面（⑦の(28)・(30)）。
//   - 印刷と同じ並びの製品カードの上で: 行の間の「＋」で工程を足す、各行の「−」で外す、↑↓で並べかえ、工程の名前を押して直す、
//     欄（はじめ・おわり／担当者／確認）を押すと 書く・書かない、確認の欄は 温度・数・○×・なし を選ぶ。製品の表のロスの列も「＋」「−」。
//   - 横に AI のチャット（声・文章）: 「焼成のあとに冷却を足して」のように話すと、AI が形を直して見た目に出す。何度でも。
//   - 「保存」で形を保存（まだ責任者が確認していないカードにすぐ出る）。A4 横1枚に収まらなくなったら知らせる。
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { buttonClass, choiceClass } from "@/components/ui";
import { fitsOnePage } from "@/lib/cards/ai-template";
import { customKey, STEP_PRESETS, type CardField, type CardTemplate, type TemplateStep } from "@/lib/cards/template";
import { chatTemplateAction, deleteTemplateAction, resetTemplatesAction, saveTemplateAction } from "../actions";

const LINE_LABEL = { bread: "パン", pizza: "ピザ" } as const;
const B = "border border-ink/60";
const TH = `${B} bg-cream px-2 py-1.5 text-left text-base font-bold whitespace-nowrap`;
const AUTO = `${B} bg-[#e6f0fb] px-2 text-sm text-[#1f3f66] whitespace-nowrap`;
const CELL_ON = `${B} cursor-pointer bg-white hover:bg-crust-50`;
const CELL_OFF = `${B} cursor-pointer bg-off-bg/70 text-center text-ink-soft hover:bg-crust-50`;
type CheckKind = "none" | "temp" | "qty" | "check";
const checkKindOf = (s: TemplateStep): CheckKind => (s.fields.includes("temp") ? "temp" : s.fields.includes("qty") ? "qty" : s.fields.includes("check") ? "check" : "none");

type Rec = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: () => void };
const speechCtor = (): (new () => Rec) | undefined => {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

export function TemplateEditor({ templates, selected, doughs, hasAi }: { templates: CardTemplate[]; selected: string; doughs: { id: string; name: string; line: "bread" | "pizza" }[]; hasAi: boolean }) {
  const router = useRouter();
  const [t, setT] = useState<CardTemplate>(() => structuredClone(templates.find((x) => x.id === selected) ?? templates[0]));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [editName, setEditName] = useState<number | null>(null);
  const [checkOpen, setCheckOpen] = useState<number | null>(null);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const saved = templates.find((x) => x.id === t.id);
  const dirty = JSON.stringify(saved) !== JSON.stringify(t);
  const fit = fitsOnePage(t);

  const setStep = (i: number, x: Partial<TemplateStep>) => setT((cur) => ({ ...cur, steps: cur.steps.map((s, j) => (j === i ? { ...s, ...x } : s)) }));
  const move = (i: number, d: -1 | 1) =>
    setT((cur) => {
      const j = i + d;
      if (j < 0 || j >= cur.steps.length) return cur;
      const steps = [...cur.steps];
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...cur, steps };
    });
  const toggle = (i: number, f: CardField) => {
    const s = t.steps[i];
    setStep(i, { fields: s.fields.includes(f) ? s.fields.filter((x) => x !== f) : [...s.fields, f] });
  };
  const setCheckKind = (i: number, k: CheckKind) => {
    const s = t.steps[i];
    const base = s.fields.filter((f) => f === "time" || f === "staff");
    setStep(i, { fields: k === "none" ? base : [...base, k], ...(k === "temp" && !s.temp ? { temp: {} } : {}) });
  };
  const insert = (at: number, key: string, name?: string) => {
    setT((cur) => {
      const used = cur.steps.map((s) => s.key);
      const p = STEP_PRESETS.find((x) => x.key === key);
      const step: TemplateStep = p && !used.includes(p.key) ? structuredClone(p) : { key: customKey(name ?? "", used), name: (name ?? p?.name ?? "新しい工程").trim(), fields: ["time", "staff"] };
      const steps = [...cur.steps];
      steps.splice(at, 0, step);
      return { ...cur, steps };
    });
    setInsertAt(null);
  };
  const save = () =>
    start(async () => {
      const r = await saveTemplateAction(t);
      setMsg(r.ok ? { ok: true, text: `「${t.name}」を保存しました。まだ確認していない製品カードにすぐ出ます` } : { ok: false, text: r.error });
      if (r.ok) router.refresh();
    });
  const go = (id: string) => router.push(`/cards/templates?id=${encodeURIComponent(id)}`);
  const newTemplate = (from?: CardTemplate) => {
    const id = `tpl-${Date.now().toString(36)}`;
    setT(from ? { ...structuredClone(from), id, name: `${from.name}のコピー`, line: undefined, doughIds: [] } : { id, name: "新しい形", steps: [] });
    setMsg({ ok: true, text: from ? "コピーを作りました。名前・使う生地を決めて保存してください" : "空の形を作りました。「＋」で工程を足して保存してください" });
  };
  const losses = t.steps.map((s, i) => ({ s, i })).filter((x) => x.s.lossLabel);

  // 行の間の「＋」
  const plus = (at: number) =>
    insertAt === at ? (
      <tr key={`plus-${at}`}>
        <td colSpan={7} className="border-x border-ink/60 bg-crust-50 p-2">
          <InsertPicker used={t.steps.map((s) => s.key)} onPick={(k, name) => insert(at, k, name)} onCancel={() => setInsertAt(null)} />
        </td>
      </tr>
    ) : (
      <tr key={`plus-${at}`} className="group">
        <td colSpan={7} className="border-x border-ink/60 bg-paper p-0 text-center">
          <button type="button" onClick={() => setInsertAt(at)} className="my-0.5 inline-flex h-6 items-center gap-1 rounded-full border border-crust-600 bg-white px-3 text-sm leading-none font-bold text-crust-700 opacity-50 group-hover:opacity-100 focus:opacity-100" aria-label={`${at + 1}番目に工程を足す`}>
            ＋ ここに工程を足す
          </button>
        </td>
      </tr>
    );

  return (
    <div className="space-y-4">
      {/* 形をえらぶ */}
      <div className="flex flex-wrap items-center gap-2">
        {templates.map((x) => (
          <button key={x.id} type="button" onClick={() => go(x.id)} className={choiceClass(x.id === t.id, "min-h-12 px-4 text-lg")}>
            {x.name}
            <span className="ml-1 text-base font-normal">{x.doughIds?.length ? `生地${x.doughIds.length}` : x.line ? LINE_LABEL[x.line] : ""}</span>
          </button>
        ))}
        <button type="button" className={buttonClass("quiet", "md")} onClick={() => newTemplate(t)}>
          コピーして新しく作る
        </button>
        <button type="button" className={buttonClass("quiet", "md")} onClick={() => newTemplate()}>
          一から作る
        </button>
      </div>

      {msg && <p role="status" className={`rounded-md border-2 p-3 text-lg ${msg.ok ? "border-ok-line bg-ok-bg text-ok-ink" : "border-alert-line bg-alert-bg text-alert-ink"}`}>{msg.text}</p>}
      {!fit.ok && <p className="rounded-md border-2 border-review-line bg-review-bg p-3 text-lg font-bold text-review-ink">！ {fit.message}</p>}

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* カードの見た目のまま */}
        <section className="min-w-0 space-y-3 rounded-lg border-2 border-rule-strong bg-white p-4 text-ink shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-ink pb-1">
            <input className="min-w-0 text-2xl font-bold outline-none focus:bg-crust-50" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} aria-label="形の名前" />
            <span className="text-base text-ink-soft">製品カード・A4 横（押すと直せます）</span>
          </div>
          <table className="w-full table-fixed border-collapse text-base">
            <tbody>
              <tr>
                {["日付", "天候", "室温", "湿度", "生地", "記入者"].map((h) => (
                  <th key={h} className={TH}>{h}</th>
                ))}
              </tr>
              <tr>
                <td className={AUTO}>11/6（金）<AutoChip /></td>
                <td className={AUTO}>晴れ<AutoChip /></td>
                <td className={`${B} h-9`} />
                <td className={`${B} h-9`} />
                <td className={AUTO}>生地<AutoChip /></td>
                <td className={`${B} h-9`} />
              </tr>
            </tbody>
          </table>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] table-fixed border-collapse text-base">
              <colgroup>
                <col className="w-[27%]" />
                <col className="w-[11%]" />
                <col />
                <col />
                <col className="w-[12%]" />
                <col className="w-[19%]" />
                <col className="w-[8%]" />
              </colgroup>
              <thead>
                <tr>
                  <th className={TH}>工程</th>
                  <th className={TH}>予定・配置</th>
                  <th className={TH}>はじめ</th>
                  <th className={TH}>おわり</th>
                  <th className={TH}>担当者</th>
                  <th className={TH}>確認</th>
                  <th className={TH}>ロス</th>
                </tr>
              </thead>
              <tbody>
                {plus(0)}
                {t.steps.map((s, i) => {
                  const ck = checkKindOf(s);
                  return [
                    <tr key={s.key} className="h-12">
                      <th className={`${B} bg-cream px-1 text-left font-bold`}>
                        <div className="flex items-center gap-1">
                          {editName === i ? (
                            <input autoFocus className="w-full min-w-0 rounded border border-crust-600 px-1" value={s.name} onChange={(e) => setStep(i, { name: e.target.value })} onBlur={() => setEditName(null)} onKeyDown={(e) => e.key === "Enter" && setEditName(null)} aria-label="工程の名前" />
                          ) : (
                            <button type="button" className="min-w-0 truncate text-left hover:underline" onClick={() => setEditName(i)} title="押すと名前を直せます">
                              {s.name}
                              {s.ccp && <span className="ml-1 text-xs text-alert-ink">CCP</span>}
                            </button>
                          )}
                          <span className="ml-auto flex shrink-0 gap-0.5">
                            <IconBtn label={`${s.name}を上へ`} disabled={i === 0} onClick={() => move(i, -1)}>↑</IconBtn>
                            <IconBtn label={`${s.name}を下へ`} disabled={i === t.steps.length - 1} onClick={() => move(i, 1)}>↓</IconBtn>
                            <IconBtn label={`${s.name}を外す`} danger onClick={() => setT({ ...t, steps: t.steps.filter((_, j) => j !== i) })}>−</IconBtn>
                          </span>
                        </div>
                      </th>
                      <td className={AUTO}>7:00〜<AutoChip /></td>
                      {s.fields.includes("time") ? (
                        <td colSpan={2} className={CELL_ON} onClick={() => toggle(i, "time")} title="押すと「書かない」">
                          <span className="block text-center text-sm whitespace-nowrap text-ink-soft">はじめ・おわりの時刻</span>
                        </td>
                      ) : (
                        <td colSpan={2} className={CELL_OFF} onClick={() => toggle(i, "time")} title="押すと時刻を書く">
                          <span className="text-sm whitespace-nowrap">時刻なし（押すと書く）</span>
                        </td>
                      )}
                      <td className={s.fields.includes("staff") ? CELL_ON : CELL_OFF} onClick={() => toggle(i, "staff")} title={s.fields.includes("staff") ? "押すと「書かない」" : "押すと担当者を書く"}>
                        <span className="block text-center text-sm">{s.fields.includes("staff") ? "担当者" : "—"}</span>
                      </td>
                      <td className={`${B} relative cursor-pointer bg-white text-sm hover:bg-crust-50`} onClick={() => setCheckOpen(checkOpen === i ? null : i)}>
                        <span className="block px-1 whitespace-nowrap">
                          {ck === "temp" ? `温度 ${s.temp?.min ?? ""}〜${s.temp?.max ?? ""}℃` : ck === "qty" ? `数（${s.qtyLabel ?? "数"}）` : ck === "check" ? `○×（${s.checkLabel ?? "確認"}）` : <span className="text-ink-soft">なし（押して選ぶ）</span>}
                        </span>
                      </td>
                      <td className={s.lossLabel ? CELL_ON : CELL_OFF} onClick={() => setStep(i, { lossLabel: s.lossLabel ? undefined : s.name })} title="製品の表に、この工程のロスの列を出す・出さない">
                        <span className="block text-center text-sm">{s.lossLabel ? "あり" : "—"}</span>
                      </td>
                    </tr>,
                    checkOpen === i ? (
                      <tr key={`${s.key}-check`}>
                        <td colSpan={7} className="border-x border-ink/60 bg-crust-50 p-3">
                          <CheckEditor step={s} kind={ck} onKind={(k) => setCheckKind(i, k)} onChange={(x) => setStep(i, x)} onClose={() => setCheckOpen(null)} />
                        </td>
                      </tr>
                    ) : null,
                    plus(i + 1),
                  ];
                })}
              </tbody>
            </table>
          </div>

          {/* 製品の表（ロスの列） */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-[20%]" />
              </colgroup>
              <thead>
                <tr>
                  <th className={TH} rowSpan={2}>この生地からとった製品</th>
                  <th className={`${TH} text-center`} colSpan={4}>分割・成形</th>
                  <th className={`${TH} text-center`} colSpan={2}>焼成</th>
                  <th className={`${TH} text-center`} colSpan={4}>包装・金属検査</th>
                  <th className={`${TH} text-center`} colSpan={Math.max(1, losses.length) + 1}>ロス数（どこで出たか）</th>
                </tr>
                <tr>
                  {["重量", "注文", "仕込", "製品数", "温度", "時間", "製品数", "在庫", "金属", "官能"].map((h) => (
                    <th key={h} className={`${TH} text-center text-sm`}>{h}</th>
                  ))}
                  {losses.map(({ s, i }) => (
                    <th key={s.key} className={`${TH} text-center text-sm`}>
                      <span className="flex items-center justify-center gap-1">
                        <input className="w-full min-w-0 bg-transparent text-center" value={s.lossLabel} onChange={(e) => setStep(i, { lossLabel: e.target.value })} aria-label="ロスの見出し" />
                        <IconBtn label={`${s.lossLabel}のロスの列を外す`} danger onClick={() => setStep(i, { lossLabel: undefined })}>−</IconBtn>
                      </span>
                    </th>
                  ))}
                  {!losses.length && <th className={`${TH} text-center text-sm text-ink-soft`}>なし</th>}
                  <th className={`${TH} text-center text-sm`}>合計</th>
                </tr>
              </thead>
              <tbody>
                <tr className="h-9">
                  <td className={`${B} px-2 whitespace-nowrap`}>① 製品名<AutoChip /></td>
                  {Array.from({ length: 10 + Math.max(1, losses.length) + 1 }, (_, k) => (
                    <td key={k} className={k < 3 ? `${B} bg-[#e6f0fb]` : B} />
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-ink-soft">ロスの列は、工程の行のいちばん右「ロス」を押すと出し入れできます。ミキサーの表・イースト・メモ・責任者確認の欄はどの形にも入ります。</p>
        </section>

        {/* AI と話して直す */}
        <TemplateChat key={t.id} template={t} hasAi={hasAi} onTemplate={(x) => setT(x)} />
      </div>

      <details className="card p-4">
        <summary className="cursor-pointer text-lg font-bold">この形を使う生地・ライン</summary>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-lg">
            ライン
            <select className="h-12 rounded-md border-2 border-rule-strong bg-sheet px-2 text-lg" value={t.line ?? ""} onChange={(e) => setT({ ...t, line: (e.target.value || undefined) as CardTemplate["line"] })}>
              <option value="">（決めない）</option>
              <option value="bread">パン</option>
              <option value="pizza">ピザ</option>
            </select>
          </label>
          {doughs.map((d) => {
            const on = !!t.doughIds?.includes(d.id);
            return (
              <button key={d.id} type="button" aria-pressed={on} onClick={() => setT({ ...t, doughIds: on ? t.doughIds!.filter((x) => x !== d.id) : [...(t.doughIds ?? []), d.id] })} className={choiceClass(on, "px-3 py-2 text-base")}>
                {d.name}
              </button>
            );
          })}
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-4">
        <button type="button" className={buttonClass("primary", "lg")} disabled={pending || !dirty} onClick={save}>
          この形を保存
        </button>
        {dirty && <span className="text-lg text-review-ink">まだ保存していません</span>}
        {saved &&
          (confirmDel ? (
            <>
              <button type="button" className={buttonClass("ghost", "md")} disabled={pending} onClick={() => start(async () => { await deleteTemplateAction(t.id); setConfirmDel(false); router.push("/cards/templates"); router.refresh(); })}>
                本当に消す
              </button>
              <button type="button" className={buttonClass("quiet", "md")} onClick={() => setConfirmDel(false)}>
                やめる
              </button>
            </>
          ) : (
            <button type="button" className={buttonClass("quiet", "md")} onClick={() => setConfirmDel(true)}>
              この形を消す
            </button>
          ))}
        <button type="button" className={buttonClass("quiet", "md")} disabled={pending} onClick={() => start(async () => { await resetTemplatesAction(); router.refresh(); })}>
          はじめの形（パン用・ピザ用）に戻す
        </button>
      </div>
    </div>
  );
}

function AutoChip() {
  return <span className="ml-1 inline-block rounded border border-[#5b84b1] bg-white px-0.5 align-middle text-[11px] leading-tight font-bold whitespace-nowrap text-[#1f3f66]">自動</span>;
}

function IconBtn({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`flex size-7 items-center justify-center rounded-md border-2 text-base font-bold disabled:opacity-30 ${danger ? "border-alert-line text-alert-ink hover:bg-alert-bg" : "border-rule-strong hover:bg-crust-50"}`}
    >
      {children}
    </button>
  );
}

function InsertPicker({ used, onPick, onCancel }: { used: string[]; onPick: (key: string, name?: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-base font-bold">足す工程:</span>
      {STEP_PRESETS.filter((p) => !used.includes(p.key)).map((p) => (
        <button key={p.key} type="button" className={choiceClass(false, "px-3 py-1 text-base")} onClick={() => onPick(p.key)}>
          {p.name}
        </button>
      ))}
      <input className="h-10 rounded-md border-2 border-rule-strong px-2 text-base" value={name} onChange={(e) => setName(e.target.value)} placeholder="名前を付けて足す" aria-label="足す工程の名前" />
      <button type="button" className={buttonClass("ghost", "md", "min-h-10")} disabled={!name.trim()} onClick={() => onPick("", name)}>
        足す
      </button>
      <button type="button" className={buttonClass("quiet", "md", "min-h-10")} onClick={onCancel}>
        やめる
      </button>
    </div>
  );
}

function CheckEditor({ step, kind, onKind, onChange, onClose }: { step: TemplateStep; kind: CheckKind; onKind: (k: CheckKind) => void; onChange: (x: Partial<TemplateStep>) => void; onClose: () => void }) {
  const num = (v: string) => {
    const t = v.replace(/[^\d.\-]/g, "");
    return t === "" || t === "-" ? undefined : Number(t);
  };
  const inp = "h-10 w-24 rounded-md border-2 border-rule-strong px-2 text-base text-right";
  return (
    <div className="flex flex-wrap items-center gap-3 text-base">
      <span className="font-bold">「{step.name}」の確認の欄:</span>
      {(["none", "temp", "qty", "check"] as const).map((k) => (
        <button key={k} type="button" aria-pressed={kind === k} className={choiceClass(kind === k, "px-3 py-1 text-base")} onClick={() => onKind(k)}>
          {{ none: "なし", temp: "温度", qty: "数", check: "○×" }[k]}
        </button>
      ))}
      {kind === "temp" && (
        <>
          {(["target", "min", "max"] as const).map((k) => (
            <label key={k} className="flex items-center gap-1">
              {{ target: "目標", min: "下限", max: "上限" }[k]}
              <input className={inp} inputMode="decimal" value={step.temp?.[k] ?? ""} onChange={(e) => onChange({ temp: { ...step.temp, [k]: num(e.target.value) } })} />℃
            </label>
          ))}
        </>
      )}
      {kind === "qty" && (
        <label className="flex items-center gap-1">
          名前
          <input className="h-10 rounded-md border-2 border-rule-strong px-2" value={step.qtyLabel ?? ""} placeholder="数" onChange={(e) => onChange({ qtyLabel: e.target.value || undefined })} />
        </label>
      )}
      {kind === "check" && (
        <label className="flex items-center gap-1">
          名前
          <input className="h-10 rounded-md border-2 border-rule-strong px-2" value={step.checkLabel ?? ""} placeholder="確認" onChange={(e) => onChange({ checkLabel: e.target.value || undefined })} />
        </label>
      )}
      <label className="flex items-center gap-1">
        <input type="checkbox" className="size-5" checked={!!step.ccp} onChange={(e) => onChange({ ccp: e.target.checked || undefined })} />
        CCP
      </label>
      <button type="button" className={buttonClass("quiet", "md", "min-h-10")} onClick={onClose}>
        とじる
      </button>
    </div>
  );
}

/** AI と話して形を直す（声・文章） */
function TemplateChat({ template, hasAi, onTemplate }: { template: CardTemplate; hasAi: boolean; onTemplate: (t: CardTemplate) => void }) {
  const [turns, setTurns] = useState<{ role: "user" | "assistant"; text: string }[]>([{ role: "assistant", text: `「${template.name}」の形を直します。たとえば「焼成のあとに冷却を足して、時刻と担当を書く欄」「保管は○×で確認」のように話してください。` }]);
  const [text, setText] = useState("");
  const [warn, setWarn] = useState<string[]>([]);
  const [pending, start] = useTransition();
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
    const next = [...turns, { role: "user" as const, text: said }];
    setTurns(next);
    setText("");
    start(async () => {
      const r = await chatTemplateAction(next, template);
      if (!r.ok) return setTurns([...next, { role: "assistant", text: `（うまくいきませんでした: ${r.error}）` }]);
      onTemplate(r.template);
      setWarn(r.warnings);
      setTurns([...next, { role: "assistant", text: `${r.reply}\n（左のカードに出しました。よければ「この形を保存」）` }]);
    });
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
  if (!hasAi) {
    return (
      <aside className="card space-y-2 p-4 text-lg">
        <p className="font-bold">AI と話して直す</p>
        <p>「設定 → AI」でキーを入れると、ここで AI に話して形を直せます。キーが無くても、左のカードで手で直せます。</p>
      </aside>
    );
  }
  return (
    <aside className="flex flex-col gap-3">
      <p className="text-xl font-bold">AI と話して直す</p>
      <ol className="card max-h-[55vh] space-y-2 overflow-y-auto p-3">
        {turns.map((x, i) => (
          <li key={i} className={x.role === "user" ? "ml-6 rounded-lg bg-crust-50 p-2 text-lg" : "mr-6 rounded-lg bg-info-bg p-2 text-lg whitespace-pre-wrap text-info-ink"}>
            <span className="block text-sm font-bold">{x.role === "user" ? "あなた" : "AI"}</span>
            {x.text}
          </li>
        ))}
        {pending && <li className="mr-6 rounded-lg bg-info-bg p-2 text-lg text-info-ink">AI が考えています…</li>}
      </ol>
      {warn.map((w) => (
        <p key={w} className="rounded-md border-2 border-review-line bg-review-bg p-2 text-base text-review-ink">！ {w}</p>
      ))}
      <textarea rows={3} className="rounded-lg border-2 border-rule-strong bg-sheet p-2 text-lg" value={text} onChange={(e) => setText(e.target.value)} placeholder="例: 焼成のあとに冷却を足して、時刻と担当を書く欄" aria-label="AI に話す" />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass("primary", "md")} disabled={pending || !text.trim()} onClick={send}>
          送る
        </button>
        {hasSpeech && (
          <button type="button" className={buttonClass(listening ? "primary" : "ghost", "md")} onClick={listen} aria-pressed={listening}>
            {listening ? "● 聞いています" : "🎤 声で話す"}
          </button>
        )}
      </div>
    </aside>
  );
}
