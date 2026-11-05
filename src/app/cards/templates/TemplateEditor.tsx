"use client";
// 製品カードの形の画面（⑦の(28)）。左＝形の一覧（パン用・ピザ用・自分で作った形）、右＝選んだ形の工程の行:
// ↑↓で並べかえ・外す・名前を直す・書く欄（時刻・担当・温度・数・○×）とロスの欄を選ぶ・工程を足す（よくある工程から／名前を付けて）。
// どのラインの生地に使うか、特定の生地だけに使うか、も決める。
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buttonClass, choiceClass } from "@/components/ui";
import { customKey, STEP_PRESETS, type CardField, type CardTemplate, type TemplateStep } from "@/lib/cards/template";
import { deleteTemplateAction, resetTemplatesAction, saveTemplateAction } from "../actions";

const FIELD_LABEL: Record<CardField, string> = { time: "時刻（はじめ・おわり）", staff: "担当者", temp: "温度", qty: "数", check: "○×" };
const field = "h-12 w-full min-w-0 rounded-md border-2 border-rule-strong bg-sheet px-2 text-lg";
const LINE_LABEL = { bread: "パン", pizza: "ピザ" } as const;

export function TemplateEditor({ templates, selected, doughs }: { templates: CardTemplate[]; selected: string; doughs: { id: string; name: string; line: "bread" | "pizza" }[] }) {
  const router = useRouter();
  const [t, setT] = useState<CardTemplate>(() => structuredClone(templates.find((x) => x.id === selected) ?? templates[0]));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [addKey, setAddKey] = useState("");
  const [addName, setAddName] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const saved = templates.find((x) => x.id === t.id);
  const dirty = JSON.stringify(saved) !== JSON.stringify(t);

  const setStep = (i: number, x: Partial<TemplateStep>) => setT({ ...t, steps: t.steps.map((s, j) => (j === i ? { ...s, ...x } : s)) });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= t.steps.length) return;
    const steps = [...t.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    setT({ ...t, steps });
  };
  const toggleField = (i: number, f: CardField) => {
    const s = t.steps[i];
    const has = s.fields.includes(f);
    setStep(i, { fields: has ? s.fields.filter((x) => x !== f) : [...s.fields, f], ...(f === "temp" && !has && !s.temp ? { temp: {} } : {}) });
  };
  const addStep = () => {
    const used = t.steps.map((s) => s.key);
    const preset = STEP_PRESETS.find((p) => p.key === addKey);
    const step: TemplateStep = preset ? structuredClone(preset) : { key: customKey(addName, used), name: addName.trim(), fields: ["time", "staff"] };
    setT({ ...t, steps: [...t.steps, step] });
    setAddKey("");
    setAddName("");
  };
  const save = () =>
    start(async () => {
      const r = await saveTemplateAction(t);
      setMsg(r.ok ? { ok: true, text: `「${t.name}」を保存しました` } : { ok: false, text: r.error });
      if (r.ok) router.refresh();
    });
  const go = (id: string) => router.push(`/cards/templates?id=${encodeURIComponent(id)}`);
  const newTemplate = (from?: CardTemplate) => {
    const id = `tpl-${Date.now().toString(36)}`;
    setT(from ? { ...structuredClone(from), id, name: `${from.name}のコピー`, line: undefined, doughIds: [] } : { id, name: "新しい形", steps: [] });
    setMsg({ ok: true, text: from ? "コピーを作りました。名前・使う生地を決めて保存してください" : "空の形を作りました。工程を足して保存してください" });
  };
  const used = new Set(t.steps.map((s) => s.key));

  return (
    <div className="grid gap-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="space-y-3">
        <p className="text-lg font-bold">形の一覧</p>
        {templates.map((x) => (
          <button key={x.id} type="button" onClick={() => go(x.id)} className={choiceClass(x.id === t.id, "w-full px-3 py-2 text-left text-lg")}>
            <span className="block">{x.name}</span>
            <span className="block text-base font-normal text-ink-soft">
              {x.doughIds?.length ? `生地 ${x.doughIds.length}つ` : x.line ? `${LINE_LABEL[x.line]}の生地` : "使う生地なし"}・工程 {x.steps.length}
            </span>
          </button>
        ))}
        <button type="button" className={buttonClass("ghost", "md", "w-full")} onClick={() => newTemplate(t)}>
          この形をコピーして新しく作る
        </button>
        <button type="button" className={buttonClass("ghost", "md", "w-full")} onClick={() => newTemplate()}>
          一から作る
        </button>
        <button type="button" className={buttonClass("quiet", "md", "w-full")} disabled={pending} onClick={() => start(async () => { await resetTemplatesAction(); router.refresh(); })}>
          はじめの形（パン用・ピザ用）に戻す
        </button>
      </aside>

      <section className="min-w-0 space-y-4">
        {msg && <p role="status" className={`rounded-md border-2 p-3 text-lg ${msg.ok ? "border-ok-line bg-ok-bg text-ok-ink" : "border-alert-line bg-alert-bg text-alert-ink"}`}>{msg.text}</p>}
        <div className="card grid gap-4 p-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-lg font-bold">
            形の名前
            <input className={field} value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-lg font-bold">
            このラインの生地に使う
            <select className={field} value={t.line ?? ""} onChange={(e) => setT({ ...t, line: (e.target.value || undefined) as CardTemplate["line"] })}>
              <option value="">（ラインでは決めない）</option>
              <option value="bread">パン</option>
              <option value="pizza">ピザ</option>
            </select>
          </label>
          <fieldset className="md:col-span-2">
            <legend className="text-lg font-bold">この生地だけに使う（選ぶと、ラインの形より先に使う）</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {doughs.map((d) => {
                const on = !!t.doughIds?.includes(d.id);
                return (
                  <button key={d.id} type="button" aria-pressed={on} onClick={() => setT({ ...t, doughIds: on ? t.doughIds!.filter((x) => x !== d.id) : [...(t.doughIds ?? []), d.id] })} className={choiceClass(on, "px-3 py-2 text-base")}>
                    {d.name}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>

        <ol className="space-y-3">
          {t.steps.map((s, i) => (
            <li key={s.key} className="card space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xl font-bold">{i + 1}</span>
                <input className={`${field} max-w-60 font-bold`} value={s.name} onChange={(e) => setStep(i, { name: e.target.value })} aria-label="工程の名前" />
                <label className="flex items-center gap-2 text-lg">
                  <input type="checkbox" className="size-6" checked={!!s.ccp} onChange={(e) => setStep(i, { ccp: e.target.checked || undefined })} />
                  CCP
                </label>
                <div className="ml-auto flex gap-2">
                  <button type="button" className={buttonClass("ghost", "md", "px-3")} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`${s.name}を上へ`}>
                    ↑
                  </button>
                  <button type="button" className={buttonClass("ghost", "md", "px-3")} disabled={i === t.steps.length - 1} onClick={() => move(i, 1)} aria-label={`${s.name}を下へ`}>
                    ↓
                  </button>
                  <button type="button" className={buttonClass("quiet", "md")} onClick={() => setT({ ...t, steps: t.steps.filter((_, j) => j !== i) })}>
                    外す
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(FIELD_LABEL) as CardField[]).map((f) => (
                  <button key={f} type="button" aria-pressed={s.fields.includes(f)} className={choiceClass(s.fields.includes(f), "px-3 py-2 text-base")} onClick={() => toggleField(i, f)}>
                    {FIELD_LABEL[f]}
                  </button>
                ))}
                <button type="button" aria-pressed={!!s.lossLabel} className={choiceClass(!!s.lossLabel, "px-3 py-2 text-base")} onClick={() => setStep(i, { lossLabel: s.lossLabel ? undefined : s.name })}>
                  ロスを製品ごとに書く
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                {s.fields.includes("temp") && (
                  <>
                    {(["target", "min", "max"] as const).map((k) => (
                      <label key={k} className="flex flex-col gap-1 text-base">
                        {k === "target" ? "目標の温度℃" : k === "min" ? "下限℃" : "上限℃"}
                        <input
                          inputMode="decimal"
                          className={`${field} num text-right`}
                          value={s.temp?.[k] ?? ""}
                          onChange={(e) => {
                            const v = e.target.value.replace(/[^\d.\-]/g, "");
                            setStep(i, { temp: { ...s.temp, [k]: v === "" || v === "-" ? undefined : Number(v) } });
                          }}
                        />
                      </label>
                    ))}
                  </>
                )}
                {s.fields.includes("qty") && (
                  <label className="flex flex-col gap-1 text-base">
                    数の欄の名前
                    <input className={field} value={s.qtyLabel ?? ""} placeholder="数" onChange={(e) => setStep(i, { qtyLabel: e.target.value || undefined })} />
                  </label>
                )}
                {s.fields.includes("check") && (
                  <label className="flex flex-col gap-1 text-base">
                    ○×の欄の名前
                    <input className={field} value={s.checkLabel ?? ""} placeholder="確認" onChange={(e) => setStep(i, { checkLabel: e.target.value || undefined })} />
                  </label>
                )}
                {s.lossLabel !== undefined && (
                  <label className="flex flex-col gap-1 text-base">
                    ロスの見出し
                    <input className={field} value={s.lossLabel} onChange={(e) => setStep(i, { lossLabel: e.target.value })} />
                  </label>
                )}
              </div>
            </li>
          ))}
          {!t.steps.length && <li className="card p-5 text-xl">工程がまだありません。下で足してください。</li>}
        </ol>

        <div className="card flex flex-wrap items-end gap-3 p-4">
          <label className="flex flex-col gap-1 text-lg font-bold">
            工程を足す
            <select className={`${field} min-w-56`} value={addKey} onChange={(e) => setAddKey(e.target.value)}>
              <option value="">（名前を付けて足す）</option>
              {STEP_PRESETS.filter((p) => !used.has(p.key)).map((p) => (
                <option key={p.key} value={p.key}>{p.name}</option>
              ))}
            </select>
          </label>
          {!addKey && (
            <label className="flex flex-col gap-1 text-lg font-bold">
              工程の名前
              <input className={`${field} min-w-56`} value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="例: ラップ巻き" />
            </label>
          )}
          <button type="button" className={buttonClass("ghost", "lg")} disabled={!addKey && !addName.trim()} onClick={addStep}>
            足す（いちばん下に）
          </button>
        </div>

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
        </div>
      </section>
    </div>
  );
}
