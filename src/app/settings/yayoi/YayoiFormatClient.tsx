"use client";
// 弥生の CSV の様式を変える画面。列の追加・削除・並べ替え、見出しの名前、決まった値の列、見出しの行・文字コード・日付・区切り。
// 下に、いまの形で出したときの見本（3行）がその場で出る。
import { useMemo, useState, useTransition } from "react";
import { useStaffNames } from "@/components/ui/staff";
import type { DeliverySlip } from "@/lib/slips/calc";
import { columnsFromHeader, DATE_FORMATS, DEFAULT_YAYOI_FORMAT, YAYOI_FIELDS, yayoiTable, type DateFormat, type YayoiColumn, type YayoiField, type YayoiFormat } from "@/lib/slips/yayoi-format";
import { resetYayoiFormatAction, saveYayoiFormatAction } from "./actions";

const FIELD_KEYS = Object.keys(YAYOI_FIELDS) as YayoiField[];
const field = "min-h-12 rounded-lg border-2 border-rule-strong bg-sheet px-3 text-[18px]";

export function YayoiFormatClient({ initial, sample }: { initial: YayoiFormat; sample: DeliverySlip[] }) {
  const STAFF = useStaffNames();
  const [f, setF] = useState<YayoiFormat>(initial);
  const [paste, setPaste] = useState("");
  const [who, setWho] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const setCol = (i: number, c: Partial<YayoiColumn>) => setF({ ...f, columns: f.columns.map((x, j) => (j === i ? { ...x, ...c } : x)) });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= f.columns.length) return;
    const cols = [...f.columns];
    [cols[i], cols[j]] = [cols[j], cols[i]];
    setF({ ...f, columns: cols });
  };
  const remove = (i: number) => setF({ ...f, columns: f.columns.filter((_, j) => j !== i) });
  const add = () => setF({ ...f, columns: [...f.columns, { label: "取引区分", source: "fixed", value: "掛売上" }] });
  const fromPaste = () => {
    const cols = columnsFromHeader(paste);
    if (!cols.length) return setMsg({ ok: false, text: "見出しの行が読めませんでした。弥生で書き出した CSV の1行目を、そのまま貼ってください" });
    const unknown = cols.filter((c) => c.source === "blank").length;
    setF({ ...f, columns: cols });
    setMsg({ ok: true, text: `${cols.length}列の並びを作りました。${unknown ? `分からなかった ${unknown}列は「空」にしてあります。中身を選んでください。` : ""}まだ保存していません。` });
  };

  const preview = useMemo(() => {
    try {
      return { head: f.columns.map((c) => c.label), rows: yayoiTable(sample, f).slice(0, 3) };
    } catch {
      return { head: [], rows: [] };
    }
  }, [f, sample]);

  const save = () =>
    start(async () => {
      const r = await saveYayoiFormatAction(f, who);
      if (r.ok) {
        setF(r.format);
        setMsg({ ok: true, text: "保存しました。次に出す弥生の CSV から、この形になります" });
      } else setMsg({ ok: false, text: r.error });
    });
  const reset = () => {
    if (!window.confirm("初期の見本（はじめの形）に戻して保存します。よろしいですか？")) return;
    start(async () => {
      const r = await resetYayoiFormatAction(who);
      if (r.ok) {
        setF(r.format);
        setMsg({ ok: true, text: "初期の見本に戻しました" });
      } else setMsg({ ok: false, text: r.error });
    });
  };

  return (
    <div className="space-y-4">
      <section className="card space-y-3 p-5">
        <h2 className="text-2xl font-bold">弥生の見出しを貼って、並びを作る</h2>
        <p className="text-[17px] text-ink-soft">弥生販売で売上伝票を書き出した CSV を開き、1行目（見出しの行）をコピーして貼ります。名前から中身を当てます（当たらない列は「空」になるので、下で選びます）。</p>
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={2} placeholder="例: 伝票日付,伝票番号,取引区分,得意先コード,得意先名,商品コード,商品名,数量,単価,金額" className="w-full rounded-lg border-2 border-rule-strong bg-sheet p-3 text-[17px]" />
        <button type="button" className="btn-ghost text-lg" onClick={fromPaste} disabled={!paste.trim()}>この見出しで並びを作る</button>
      </section>

      <section className="card p-0">
        <h2 className="border-b-2 border-rule-strong px-5 py-3 text-2xl font-bold">列（上から順に、CSV の左から）</h2>
        <ol>
          {f.columns.map((c, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 border-b border-rule px-5 py-2 last:border-b-0">
              <span className="w-8 text-right text-lg font-bold text-ink-soft">{i + 1}</span>
              <label className="flex items-center gap-1 text-[16px] text-ink-soft">
                見出し
                <input className={`${field} w-44`} value={c.label} onChange={(e) => setCol(i, { label: e.target.value })} aria-label={`${i + 1}列目の見出し`} />
              </label>
              <label className="flex items-center gap-1 text-[16px] text-ink-soft">
                中身
                <select
                  className={`${field} w-52`}
                  value={c.source}
                  aria-label={`${i + 1}列目の中身`}
                  onChange={(e) => {
                    const source = e.target.value as YayoiColumn["source"];
                    setCol(i, { source, ...(source === "fixed" ? { value: c.value ?? "" } : { value: undefined }) });
                  }}
                >
                  {FIELD_KEYS.map((k) => <option key={k} value={k}>{YAYOI_FIELDS[k]}</option>)}
                  <option value="fixed">決まった値</option>
                  <option value="blank">空（何も入れない）</option>
                </select>
              </label>
              {c.source === "fixed" && <input className={`${field} w-36`} value={c.value ?? ""} placeholder="例: 掛売上" onChange={(e) => setCol(i, { value: e.target.value })} aria-label={`${i + 1}列目の決まった値`} />}
              <span className="ml-auto flex gap-1">
                <button type="button" className="btn-ghost min-w-12 text-lg" onClick={() => move(i, -1)} disabled={i === 0} aria-label="上へ">↑</button>
                <button type="button" className="btn-ghost min-w-12 text-lg" onClick={() => move(i, 1)} disabled={i === f.columns.length - 1} aria-label="下へ">↓</button>
                <button type="button" className="btn-ghost text-lg" onClick={() => remove(i)} disabled={f.columns.length <= 1}>消す</button>
              </span>
            </li>
          ))}
        </ol>
        <div className="px-5 py-3">
          <button type="button" className="btn-ghost text-lg" onClick={add}>＋ 列を足す</button>
        </div>
      </section>

      <section className="card grid gap-4 p-5 sm:grid-cols-2">
        <label className="flex items-center gap-3 text-[18px] font-bold">
          <input type="checkbox" className="size-6" checked={f.header} onChange={(e) => setF({ ...f, header: e.target.checked })} />
          1行目に見出しを入れる
        </label>
        <label className="block text-[18px] font-bold">
          文字コード
          <select className={`${field} mt-1 w-full font-normal`} value={f.encoding} onChange={(e) => setF({ ...f, encoding: e.target.value as YayoiFormat["encoding"] })}>
            <option value="sjis">Shift_JIS（弥生でふつう）</option>
            <option value="utf8">UTF-8</option>
          </select>
        </label>
        <label className="block text-[18px] font-bold">
          日付の形
          <select className={`${field} mt-1 w-full font-normal`} value={f.dateFormat} onChange={(e) => setF({ ...f, dateFormat: e.target.value as DateFormat })}>
            {(Object.keys(DATE_FORMATS) as DateFormat[]).map((k) => <option key={k} value={k}>{DATE_FORMATS[k]}</option>)}
          </select>
        </label>
        <label className="block text-[18px] font-bold">
          区切り
          <select className={`${field} mt-1 w-full font-normal`} value={f.delimiter} onChange={(e) => setF({ ...f, delimiter: e.target.value as YayoiFormat["delimiter"] })}>
            <option value="comma">カンマ（,）</option>
            <option value="tab">タブ</option>
          </select>
        </label>
        <label className="block text-[18px] font-bold sm:col-span-2">
          担当者コード（「担当者コード」の列に入れる値。空なら空）
          <input className={`${field} mt-1 w-full font-normal`} value={f.staffCode ?? ""} placeholder="例: 0001" onChange={(e) => setF({ ...f, staffCode: e.target.value })} />
        </label>
      </section>

      <section className="card p-5">
        <h2 className="text-2xl font-bold">見本（いまの形で、はじめの3行）</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full border-collapse text-[16px]">
            {f.header && (
              <thead>
                <tr>{preview.head.map((h, i) => <th key={i} className="whitespace-nowrap border border-rule-strong bg-cream px-2 py-1 text-left">{h}</th>)}</tr>
              </thead>
            )}
            <tbody>
              {preview.rows.map((r, i) => (
                <tr key={i}>{r.map((v, j) => <td key={j} className="whitespace-nowrap border border-rule px-2 py-1">{String(v)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[16px] text-ink-soft">{f.encoding === "sjis" ? "Shift_JIS" : "UTF-8"}・{f.delimiter === "tab" ? "タブ区切り" : "カンマ区切り"}・{f.header ? "見出しあり" : "見出しなし"}で出します。</p>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <button type="button" className="btn-ghost mr-auto text-lg" onClick={() => setF(DEFAULT_YAYOI_FORMAT)}>画面を初期の見本にする（まだ保存しない）</button>
        <label className="flex items-center gap-2 text-[18px]">
          保存する人
          <select className={field} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">（選んでください）</option>
            {STAFF.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <button type="button" className="btn-ghost text-lg" onClick={reset} disabled={pending || !who}>初期の見本に戻して保存</button>
        <button type="button" className="btn-primary text-lg" onClick={save} disabled={pending || !who}>保存</button>
      </div>
      {msg && <p role="status" className={`text-lg font-bold ${msg.ok ? "text-ok-ink" : "text-alert-ink"}`}>{msg.text}</p>}
    </div>
  );
}
