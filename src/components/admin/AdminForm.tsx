"use client";
// マスタの1件の登録・修正（②）。列の定義（ColumnDef）から入力欄を作る。保存は呼ぶ側の server action。
import { useState, useTransition } from "react";
import { Button, Notice } from "@/components/ui";
import type { ColumnDef, Row, SaveResult } from "./types";

const field = "min-h-12 w-full rounded-lg border-2 border-rule-strong bg-sheet px-3 text-ink focus:border-crust-600 focus:outline-none";

export function AdminForm({
  columns, initial, isNew, onSave, onCancel, extra,
}: {
  columns: ColumnDef[];
  initial: Row;
  isNew: boolean;
  /** 保存（呼ぶ側の server action）。無ければ「準備中」 */
  onSave?: (row: Row) => Promise<SaveResult>;
  onCancel: () => void;
  /** フォームの下に置く追加の部品（取引先の LINE ひも付けなど） */
  extra?: React.ReactNode;
}) {
  const [row, setRow] = useState<Row>(initial);
  const [error, setError] = useState<{ text: string; field?: string } | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const set = (k: string, v: Row[string]) => {
    setDone(false);
    setRow((r) => ({ ...r, [k]: v }));
  };
  const cols = columns.filter((c) => c.form !== false);
  const missing = cols.filter((c) => c.required && (row[c.key] === undefined || row[c.key] === null || row[c.key] === ""));

  const save = () => {
    if (!onSave) return;
    setError(null);
    start(async () => {
      const r = await onSave(row);
      if (r.ok) setDone(true);
      else setError({ text: r.error, field: r.field });
    });
  };

  return (
    <section className="rounded-lg border-2 border-crust-600 bg-sheet">
      <h2 className="border-b border-rule bg-cream px-4 py-2 text-lg font-black">{isNew ? "新しく登録" : "登録内容を直す"}</h2>
      <div className="grid gap-x-5 gap-y-4 p-4 sm:grid-cols-2">
        {cols.map((c) => {
          const v = row[c.key];
          const bad = error?.field === c.key;
          const id = `f-${c.key}`;
          return (
            <div key={c.key} className={c.type === "textarea" ? "sm:col-span-2" : ""}>
              <label htmlFor={id} className="mb-1 flex items-baseline gap-2 font-bold">
                {c.label}
                {c.required && <span className="text-sm text-crust-700">（必ず入れる）</span>}
              </label>
              {c.type === "select" ? (
                <select id={id} className={field} value={String(v ?? "")} disabled={c.readOnly} onChange={(e) => set(c.key, e.target.value)}>
                  <option value="">えらんでください</option>
                  {c.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : c.type === "bool" ? (
                <div className="flex gap-2">
                  {[true, false].map((b) => (
                    <button
                      key={String(b)}
                      type="button"
                      disabled={c.readOnly}
                      onClick={() => set(c.key, b)}
                      className={`min-h-12 flex-1 rounded-lg border-2 font-bold ${v === b ? "border-crust-600 bg-crust-50 text-crust-700" : "border-rule-strong bg-sheet"}`}
                    >
                      {b ? "はい" : "いいえ"}
                    </button>
                  ))}
                </div>
              ) : c.type === "textarea" ? (
                <textarea id={id} className={`${field} min-h-24 py-2`} value={String(v ?? "")} readOnly={c.readOnly} onChange={(e) => set(c.key, e.target.value)} />
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    id={id}
                    className={`${field} ${c.type === "number" ? "num text-right" : ""} ${bad ? "border-alert-line" : ""} ${c.readOnly ? "bg-off-bg text-off-ink" : ""}`}
                    type={c.type === "number" ? "text" : c.type === "time" ? "time" : c.type === "date" ? "date" : "text"}
                    inputMode={c.type === "number" ? "decimal" : undefined}
                    value={String(v ?? "")}
                    readOnly={c.readOnly}
                    onChange={(e) => set(c.key, c.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value.replace(/[^0-9.\-]/g, "")) || 0) : e.target.value)}
                  />
                  {c.unit && <span className="shrink-0 font-bold text-ink-soft">{c.unit}</span>}
                </div>
              )}
              {c.help && <p className="mt-1 text-sm text-ink-soft">{c.help}</p>}
              {bad && <p className="mt-1 text-sm font-bold text-alert-ink">{error?.text}</p>}
            </div>
          );
        })}
      </div>
      {extra && <div className="border-t border-rule p-4">{extra}</div>}
      <div className="space-y-2 border-t border-rule p-4">
        {error && !error.field && <Notice tone="alert">{error.text}</Notice>}
        {done && <Notice tone="ok">保存しました。</Notice>}
        {!onSave && <Notice tone="info">この画面の保存は準備中です（データの置き場所ができしだい使えます）。</Notice>}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="lg" className="min-w-48" disabled={!onSave || pending || missing.length > 0} onClick={save}>
            {pending ? "保存しています…" : isNew ? "登録する" : "保存する"}
          </Button>
          <Button size="lg" onClick={onCancel}>
            とじる
          </Button>
          {missing.length > 0 && <span className="self-center text-sm text-ink-soft">まだ入っていない所：{missing.map((c) => c.label).join("・")}</span>}
        </div>
      </div>
    </section>
  );
}
