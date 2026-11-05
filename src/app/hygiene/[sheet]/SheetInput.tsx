"use client";
// 衛生管理のシートのタブレット入力（⑦の(21)）。形ごとに:
//   temp  … 日ごとに ①午前 ②午後（湿度）。管理範囲の外は赤、措置を書く
//   clean … 日を選ぶ → その日の計画（○）の項目を押すと ●（した）。下に月の一覧
//   check … 日を選ぶ → 項目ごとに ✓。下に月の一覧
//   log   … 1行ずつ足す（○×の欄は押して選ぶ）
//   label … 使用可能日を入れて、ラベルを印刷
// 押すたびに保存する（少し待ってまとめて）。月ごとに責任者が確認したら、外すまで直せない。
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { buttonClass, choiceClass } from "@/components/ui";
import { FREQ_LABEL, isPlanned, outOfRange, WD, type Day, type Freq, type SheetDef, type SheetItem, type SheetRecord, type TempEntry } from "@/lib/hygiene/sheets";
import { approveRecordAction, saveRecordAction, saveSheetItemsAction } from "../actions";

const CELL = "h-16 w-full min-w-0 rounded-md border-2 bg-sheet px-2 text-[22px]";
const TH = "border border-rule-strong bg-cream px-2 py-2 text-left text-lg font-bold";
const TD = "border border-rule-strong p-1 align-middle";

export function SheetInput({ def, month, run, days, today, initial }: { def: SheetDef; month: string; run: Day[]; days: Day[]; today: string; initial: SheetRecord }) {
  const [rec, setRec] = useState<SheetRecord>(initial);
  // 記入する人は、この端末で前に入れた名前を使う
  const [who, setWho] = useState(() => (typeof window === "undefined" ? "" : (localStorage.getItem("hub.hygiene.who") ?? "")));
  const [boss, setBoss] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const approved = !!rec.approvedBy;

  const setName = (s: string) => {
    setWho(s);
    localStorage.setItem("hub.hygiene.who", s);
  };

  // 変えたら少し待って保存
  const update = (fn: (r: SheetRecord) => SheetRecord) => {
    if (approved) return;
    setRec((r) => {
      const next = fn(r);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setStatus({ ok: true, text: "保存しています…" });
        void saveRecordAction(def.id, month, next, who).then((x) => setStatus(x.ok ? { ok: true, text: `保存しました（${new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}）` } : { ok: false, text: x.error }));
      }, 600);
      return next;
    });
  };
  const approve = (name: string) =>
    start(async () => {
      const r = await approveRecordAction(def.id, month, name);
      if (!r.ok) return setStatus({ ok: false, text: r.error });
      setRec((x) => (name ? { ...x, approvedBy: name, approvedAt: new Date().toISOString() } : { ...x, approvedBy: undefined, approvedAt: undefined }));
      setStatus({ ok: true, text: name ? `${name} さんが確認しました` : "確認を外しました。直せます" });
    });

  return (
    <div className="space-y-6 pb-28">
      {def.rule && <p className="rounded-lg border-2 border-info-line bg-info-bg p-4 text-xl text-info-ink">{def.rule}</p>}

      <label className="flex max-w-md flex-col gap-1 text-xl font-bold">
        記入する人（担当者名）
        <input suppressHydrationWarning className={`${CELL} border-rule-strong`} value={who} onChange={(e) => setName(e.target.value)} placeholder="名前" />
      </label>

      {def.kind === "temp" && <TempInput def={def} run={run} today={today} rec={rec} update={update} who={who} disabled={approved} />}
      {(def.kind === "clean" || def.kind === "check") && <DoneInput def={def} run={run} days={days} today={today} rec={rec} update={update} who={who} disabled={approved} />}
      {def.kind === "log" && <LogInput def={def} rec={rec} update={update} who={who} today={today} disabled={approved} />}
      {def.kind === "label" && <LabelInput rec={rec} update={update} month={month} disabled={approved} />}

      {def.kind !== "label" && (
        <section className="grid gap-4 rounded-lg border-[3px] border-ink p-5 md:grid-cols-[1fr_2fr]">
          <div>
            <h2 className="text-2xl font-bold">責任者の確認（{Number(month.slice(5))}月分）</h2>
            <p className="mt-1 text-lg text-ink-soft">月末に中身を見て確認します。確認すると、外すまで直せません。</p>
          </div>
          {approved ? (
            <div className="flex flex-wrap items-center gap-4">
              <p className="rounded-md border-2 border-ok-line bg-ok-bg px-5 py-4 text-3xl font-bold text-ok-ink">✓ {rec.approvedBy}</p>
              <button type="button" className={buttonClass("quiet", "lg")} disabled={pending} onClick={() => approve("")}>
                確認を外して直す
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex min-w-72 flex-1 flex-col gap-1 text-xl font-bold">
                責任者の名前
                <input className={`${CELL} border-rule-strong`} value={boss} onChange={(e) => setBoss(e.target.value)} />
              </label>
              <button type="button" className={buttonClass("ghost", "lg", "h-16 px-8")} disabled={pending || !boss.trim()} onClick={() => approve(boss)}>
                確認した
              </button>
            </div>
          )}
        </section>
      )}

      {(def.kind === "clean" || def.kind === "check") && <ItemEditor def={def} />}

      <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t-2 border-rule-strong bg-sheet/95 px-6 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4">
          <p role="status" className={`text-xl ${status ? (status.ok ? "text-ok-ink" : "font-bold text-alert-ink") : "text-ink-soft"}`}>
            {status?.text ?? (approved ? "責任者が確認した月です" : "入れると自動で保存します")}
          </p>
          <Link href={`/hygiene/print?month=${month}&sheet=${def.id}`} className="link ml-auto text-xl">
            印刷する（A4 横）
          </Link>
        </div>
      </div>
    </div>
  );
}

type Upd = (fn: (r: SheetRecord) => SheetRecord) => void;

function num(v: string): number | undefined {
  const t = v.replace(/[^\d.\-]/g, "");
  return t === "" || t === "-" ? undefined : Number(t);
}

// ───────── 温度 ─────────
function TempInput({ def, run, today, rec, update, who, disabled }: { def: SheetDef; run: Day[]; today: string; rec: SheetRecord; update: Upd; who: string; disabled: boolean }) {
  const t = def.temp!;
  const set = (date: string, k: keyof TempEntry, v: TempEntry[keyof TempEntry]) =>
    update((r) => ({ ...r, temps: { ...r.temps, [date]: { ...r.temps?.[date], [k]: v, ...(who && !r.temps?.[date]?.who ? { who } : {}) } } }));
  const todayRow = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    // 新しい Chrome は scrollIntoView が Promise を返すので、返り値を effect の後片付けにしない
    todayRow.current?.scrollIntoView({ block: "center" });
  }, []);
  const range = [t.min != null ? `${t.min}${t.unit}` : "", t.max != null ? `${t.max}${t.unit}` : ""].join("〜");
  return (
    <section>
      <h2 className="mb-2 text-xl font-bold">
        {t.set != null ? `設定 ${t.set}${t.unit}・` : ""}管理範囲 {range}（外れたら赤。異常時の措置を書く）
      </h2>
      <div className="overflow-x-auto">
        <table className="m-keep w-full min-w-[900px] table-fixed border-collapse">
          <thead>
            <tr>
              <th className={`${TH} w-32`}>日付</th>
              <th className={TH}>①午前 {t.unit}</th>
              {t.perDay === 2 && <th className={TH}>②午後 {t.unit}</th>}
              {t.humidity && <th className={TH}>湿度① %</th>}
              {t.humidity && t.perDay === 2 && <th className={TH}>湿度② %</th>}
              <th className={`${TH} w-[28%]`}>異常時の措置</th>
              <th className={TH}>担当者</th>
            </tr>
          </thead>
          <tbody>
            {run.map((d) => {
              const e = rec.temps?.[d.date] ?? {};
              const isToday = d.date === today;
              const box = (k: "am" | "pm" | "humAm" | "humPm", label: string) => {
                const bad = (k === "am" || k === "pm") && outOfRange(t, e[k]);
                return (
                  <td className={TD}>
                    <input
                      inputMode="decimal"
                      aria-label={`${d.d}日 ${label}`}
                      disabled={disabled}
                      className={`${CELL} num text-right ${bad ? "border-alert-ink bg-alert-bg text-alert-ink" : "border-rule-strong"}`}
                      value={e[k] ?? ""}
                      onChange={(ev) => set(d.date, k, num(ev.target.value))}
                    />
                  </td>
                );
              };
              const bad = [e.am, e.pm].some((v) => outOfRange(t, v));
              return (
                <tr key={d.date} ref={isToday ? todayRow : undefined} className={isToday ? "bg-crust-50" : ""}>
                  <th className={`${TH} ${isToday ? "bg-crust-50 text-crust-700" : ""}`}>
                    {d.d}日（{WD[d.weekday]}）{isToday && <span className="block text-base">きょう</span>}
                  </th>
                  {box("am", "①午前")}
                  {t.perDay === 2 && box("pm", "②午後")}
                  {t.humidity && box("humAm", "湿度①")}
                  {t.humidity && t.perDay === 2 && box("humPm", "湿度②")}
                  <td className={TD}>
                    <input aria-label={`${d.d}日 異常時の措置`} disabled={disabled} className={`${CELL} text-lg ${bad && !e.action ? "border-alert-ink bg-alert-bg" : "border-rule-strong"}`} value={e.action ?? ""} onChange={(ev) => set(d.date, "action", ev.target.value || undefined)} placeholder={bad ? "措置を書いてください" : ""} />
                  </td>
                  <td className={TD}>
                    <input aria-label={`${d.d}日 担当者`} disabled={disabled} className={`${CELL} text-lg border-rule-strong`} value={e.who ?? ""} onChange={(ev) => set(d.date, "who", ev.target.value || undefined)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ───────── 点検清掃・毎日チェック ─────────
function DoneInput({ def, run, days, today, rec, update, who, disabled }: { def: SheetDef; run: Day[]; days: Day[]; today: string; rec: SheetRecord; update: Upd; who: string; disabled: boolean }) {
  const [date, setDate] = useState(run.find((d) => d.date === today)?.date ?? run.find((d) => d.date > today)?.date ?? run.at(-1)?.date ?? "");
  const day = days.find((d) => d.date === date);
  const items = def.items ?? [];
  const todays = day ? items.filter((it) => def.kind === "check" || isPlanned(it, day, run)) : [];
  const key = (it: SheetItem, d: string) => `${it.id}|${d}`;
  const toggle = (it: SheetItem) =>
    update((r) => {
      const k = key(it, date);
      const done = { ...r.done };
      if (done[k] != null) delete done[k];
      else done[k] = who || "";
      return { ...r, done };
    });
  const allDone = todays.length > 0 && todays.every((it) => rec.done?.[key(it, date)] != null);
  const mark = def.kind === "check" ? "✓" : "●";
  return (
    <section className="space-y-5">
      <div>
        <h2 className="mb-2 text-xl font-bold">日を選ぶ</h2>
        <div className="flex flex-wrap gap-2">
          {run.map((d) => (
            <button key={d.date} type="button" aria-pressed={d.date === date} onClick={() => setDate(d.date)} className={choiceClass(d.date === date, `h-14 w-20 text-lg ${d.date === today ? "underline" : ""}`)}>
              {d.d}（{WD[d.weekday]}）
            </button>
          ))}
        </div>
      </div>

      {day && (
        <div>
          <h2 className="mb-2 text-2xl font-bold">
            {day.d}日（{WD[day.weekday]}）の{def.kind === "check" ? "チェック" : "点検・清掃"}（{todays.length}項目）{allDone && <span className="ml-3 text-ok-ink">✓ 全部済み</span>}
          </h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {todays.map((it) => {
              const done = rec.done?.[key(it, date)] != null;
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-pressed={done}
                    onClick={() => toggle(it)}
                    className={`flex min-h-20 w-full items-center gap-4 rounded-lg border-2 px-4 py-3 text-left ${done ? "border-ok-ink bg-ok-bg" : "border-rule-strong bg-sheet hover:border-crust-600"}`}
                  >
                    <span className={`flex size-12 shrink-0 items-center justify-center rounded-full border-2 text-3xl ${done ? "border-ok-ink bg-ok-ink text-white" : "border-rule-strong"}`}>{done ? mark : def.kind === "check" ? "" : "○"}</span>
                    <span className="min-w-0">
                      <span className="block text-xl font-bold">
                        {it.name}
                        {it.qty != null && <span className="ml-2 font-normal">{it.qty}こ</span>}
                      </span>
                      {(it.note || it.group || it.freq) && (
                        <span className="block text-lg text-ink-soft">
                          {[it.group, it.note, def.kind === "clean" && it.freq ? FREQ_LABEL[it.freq] : ""].filter(Boolean).join("・")}
                        </span>
                      )}
                      {done && rec.done?.[key(it, date)] && <span className="block text-base text-ok-ink">{rec.done[key(it, date)]}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
            {!todays.length && <li className="text-xl">この日の計画はありません。</li>}
          </ul>
        </div>
      )}

      <details className="card p-4">
        <summary className="cursor-pointer text-xl font-bold">月の一覧（{def.kind === "clean" ? "○＝計画・●＝した" : "✓＝した"}）</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="m-keep border-collapse text-base">
            <thead>
              <tr>
                <th className="sticky left-0 border border-rule-strong bg-cream px-2 text-left">項目</th>
                {days.map((d) => (
                  <th key={d.date} className={`w-8 border border-rule-strong px-0.5 text-center ${d.weekday === 0 ? "text-alert-ink" : ""} ${d.date === today ? "bg-crust-50" : "bg-cream"}`}>
                    {d.d}
                    <br />
                    {WD[d.weekday]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <th className="sticky left-0 border border-rule-strong bg-sheet px-2 text-left font-normal whitespace-nowrap">{it.name}</th>
                  {days.map((d) => {
                    const done = rec.done?.[key(it, d.date)] != null;
                    const off = !run.some((r) => r.date === d.date);
                    const plan = def.kind === "clean" && isPlanned(it, d, run);
                    return (
                      <td key={d.date} className={`h-8 border border-rule-strong text-center ${off ? "bg-off-bg" : ""}`}>
                        {done ? mark : plan ? "○" : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

// ───────── 記録の表 ─────────
function LogInput({ def, rec, update, who, today, disabled }: { def: SheetDef; rec: SheetRecord; update: Upd; who: string; today: string; disabled: boolean }) {
  const cols = def.columns ?? [];
  const blank = () => Object.fromEntries(cols.map((c) => [c.key, c.type === "date" ? today : c.key === "who" ? who : ""])) as Record<string, string | number>;
  const [row, setRow] = useState<Record<string, string | number>>(blank);
  const rows = rec.rows ?? [];
  const hasNg = cols.some((c) => c.type === "okng" && row[c.key] === "ng");
  const add = () => {
    update((r) => ({ ...r, rows: [...(r.rows ?? []), row] }));
    setRow(blank());
  };
  return (
    <section className="space-y-5">
      <div className="card space-y-4 p-5">
        <h2 className="text-2xl font-bold">1行足す</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {cols.map((c) => (
            <label key={c.key} className="flex flex-col gap-1 text-xl font-bold">
              {c.label}
              {c.type === "okng" ? (
                <div className="flex gap-2">
                  {(["ok", "ng"] as const).map((v) => {
                    const on = row[c.key] === v;
                    return (
                      <button key={v} type="button" disabled={disabled} aria-pressed={on} onClick={() => setRow({ ...row, [c.key]: on ? "" : v })} className={`h-16 flex-1 rounded-md border-2 text-[24px] font-bold ${on ? (v === "ok" ? "border-ok-ink bg-ok-bg text-ok-ink" : "border-alert-ink bg-alert-bg text-alert-ink") : "border-rule-strong bg-sheet"}`}>
                        {v === "ok" ? "○" : "×"}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <input
                  type={c.type === "date" ? "date" : "text"}
                  inputMode={c.type === "number" ? "decimal" : undefined}
                  disabled={disabled}
                  className={`${CELL} ${c.key === "action" && hasNg && !row.action ? "border-alert-ink bg-alert-bg" : "border-rule-strong"} ${c.type === "number" ? "num text-right" : ""}`}
                  value={String(row[c.key] ?? "")}
                  onChange={(e) => setRow({ ...row, [c.key]: c.type === "number" ? (num(e.target.value) ?? "") : e.target.value })}
                />
              )}
            </label>
          ))}
        </div>
        {hasNg && !String(row.action ?? "").trim() && <p className="text-xl font-bold text-alert-ink">！ ×があります。措置を書いてから足してください</p>}
        <button type="button" className={buttonClass("primary", "lg")} disabled={disabled || (hasNg && !String(row.action ?? "").trim())} onClick={add}>
          この行を足す
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="m-keep w-full min-w-[900px] border-collapse text-lg">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} className={TH}>{c.label}</th>
              ))}
              <th className={`${TH} w-24`}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c.key} className={`${TD} px-2 ${r[c.key] === "ng" ? "font-bold text-alert-ink" : ""}`}>
                    {c.type === "okng" ? (r[c.key] === "ok" ? "○" : r[c.key] === "ng" ? "×" : "") : String(r[c.key] ?? "")}
                  </td>
                ))}
                <td className={TD}>
                  <button type="button" disabled={disabled} className={buttonClass("quiet", "md")} onClick={() => update((x) => ({ ...x, rows: (x.rows ?? []).filter((_, j) => j !== i) }))}>
                    消す
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td className={`${TD} px-2`} colSpan={cols.length + 1}>
                  まだありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ───────── ラベル ─────────
function LabelInput({ rec, update, month, disabled }: { rec: SheetRecord; update: Upd; month: string; disabled: boolean }) {
  const [d, setD] = useState("");
  const labels = rec.labels ?? [];
  return (
    <section className="card space-y-4 p-5">
      <h2 className="text-2xl font-bold">使用可能日のラベル</h2>
      <p className="text-lg">使用可能日を入れて「足す」。同じ日を何枚でも足せます。A4 1枚に 15枚（5段×3列）。</p>
      <div className="flex flex-wrap items-end gap-3">
        <input type="date" aria-label="使用可能日" className={`${CELL} max-w-xs border-rule-strong`} value={d} onChange={(e) => setD(e.target.value)} />
        {[1, 3, 15].map((n) => (
          <button key={n} type="button" disabled={disabled || !d} className={buttonClass("ghost", "lg")} onClick={() => update((r) => ({ ...r, labels: [...(r.labels ?? []), ...Array(n).fill(d)] }))}>
            {n}枚 足す
          </button>
        ))}
      </div>
      <p className="text-xl">
        今 {labels.length}枚：{[...new Set(labels)].map((x) => `${Number(x.slice(5, 7))}/${Number(x.slice(8))}×${labels.filter((y) => y === x).length}`).join("・") || "なし"}
      </p>
      <div className="flex gap-3">
        <button type="button" disabled={disabled || !labels.length} className={buttonClass("quiet", "lg")} onClick={() => update((r) => ({ ...r, labels: [] }))}>
          全部消す
        </button>
        <Link href={`/hygiene/print?month=${month}&sheet=label-use-by`} className="btn-primary text-xl">
          ラベルを印刷する
        </Link>
      </div>
    </section>
  );
}

// ───────── 項目を直す ─────────
function ItemEditor({ def }: { def: SheetDef }) {
  const [items, setItems] = useState<SheetItem[]>(def.items ?? []);
  const [weekdays, setWeekdays] = useState<number[]>(def.weekdays ?? []);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const set = (i: number, k: keyof SheetItem, v: SheetItem[keyof SheetItem]) => setItems(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const inp = "h-12 w-full min-w-0 rounded-md border-2 border-rule-strong bg-sheet px-2 text-lg";
  return (
    <details className="card p-5">
      <summary className="cursor-pointer text-xl font-bold">項目・記入する曜日を直す（管理者）</summary>
      <fieldset className="mt-4">
        <legend className="text-lg font-bold">記入する曜日（選ばなければ毎日）</legend>
        <div className="mt-1 flex gap-2">
          {[...WD].map((w, i) => (
            <button key={w} type="button" aria-pressed={weekdays.includes(i)} onClick={() => setWeekdays(weekdays.includes(i) ? weekdays.filter((x) => x !== i) : [...weekdays, i].sort())} className={choiceClass(weekdays.includes(i), "size-12 text-lg")}>
              {w}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="mt-4 overflow-x-auto">
        <table className="m-keep w-full min-w-[900px] border-collapse text-lg">
          <thead>
            <tr>
              <th className={TH}>名前</th>
              <th className={TH}>備考・場所</th>
              <th className={TH}>まとまり</th>
              {def.kind === "clean" && <th className={TH}>頻度</th>}
              {def.kind === "clean" && <th className={TH}>曜日／日</th>}
              {def.kind === "check" && <th className={TH}>数</th>}
              <th className={TH}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((x, i) => (
              <tr key={x.id}>
                <td className={TD}><input className={inp} value={x.name} onChange={(e) => set(i, "name", e.target.value)} aria-label="名前" /></td>
                <td className={TD}><input className={inp} value={x.note ?? ""} onChange={(e) => set(i, "note", e.target.value || undefined)} aria-label="備考" /></td>
                <td className={TD}><input className={inp} value={x.group ?? ""} onChange={(e) => set(i, "group", e.target.value || undefined)} aria-label="まとまり" /></td>
                {def.kind === "clean" && (
                  <td className={TD}>
                    <select className={inp} value={x.freq ?? "daily"} onChange={(e) => set(i, "freq", e.target.value as Freq)} aria-label="頻度">
                      {(Object.keys(FREQ_LABEL) as Freq[]).map((f) => (
                        <option key={f} value={f}>{FREQ_LABEL[f]}</option>
                      ))}
                    </select>
                  </td>
                )}
                {def.kind === "clean" && (
                  <td className={TD}>
                    {x.freq === "monthly" ? (
                      <input className={inp} inputMode="numeric" placeholder="最初の日" value={x.monthDay ?? ""} onChange={(e) => set(i, "monthDay", num(e.target.value))} aria-label="日" />
                    ) : x.freq === "weekly" || x.freq === "biweekly" ? (
                      <select className={inp} value={x.weekday ?? 3} onChange={(e) => set(i, "weekday", Number(e.target.value))} aria-label="曜日">
                        {[...WD].map((w, j) => (
                          <option key={w} value={j}>{w}曜</option>
                        ))}
                      </select>
                    ) : (
                      "—"
                    )}
                  </td>
                )}
                {def.kind === "check" && (
                  <td className={TD}><input className={inp} inputMode="numeric" value={x.qty ?? ""} onChange={(e) => set(i, "qty", num(e.target.value))} aria-label="数" /></td>
                )}
                <td className={TD}>
                  <button type="button" className={buttonClass("quiet", "md")} onClick={() => setItems(items.filter((_, j) => j !== i))}>
                    消す
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className={buttonClass("ghost", "md")} onClick={() => setItems([...items, { id: `x${Date.now().toString(36)}`, name: "", freq: def.kind === "clean" ? "daily" : undefined }])}>
          ＋ 項目を足す
        </button>
        <button
          type="button"
          className={buttonClass("primary", "md")}
          disabled={pending}
          onClick={() => start(async () => {
            const r = await saveSheetItemsAction(def.id, items, undefined, undefined, weekdays);
            setMsg(r.ok ? "保存しました。上の表に反映します" : r.error);
          })}
        >
          項目を保存
        </button>
        {msg && <span className="text-lg">{msg}</span>}
      </div>
    </details>
  );
}
