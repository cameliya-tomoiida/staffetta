"use client";
// マスタ管理の画面（⑤）。見た目は②の共通部品。保存は API 経由（/api/masters/[name]）。
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button, buttonClass, fmtDateTime, Notice, Tag } from "@/components/ui";
import type { ColumnType } from "@/lib/masters/columns";
import type { Preview } from "@/lib/masters/csv";

type Rec = Record<string, unknown> & { id: string; disabled?: boolean };
type RefIndex = Record<string, { id: string; name?: string }[]>;
/** 画面に渡す列の説明（③の ColumnDef から関数を除いたもの） */
export interface ClientColumn {
  key: string;
  label: string;
  type: ColumnType;
  required: boolean;
  options?: { value: string; label: string }[];
  ref?: string;
  help?: string;
  example?: string;
}
const STAFF = ["課長 こばやし", "事務 たなか", "専務 はやし"];

/** 値を CSV と同じ書き方の文字にする（フォームの初期値・一覧の表示） */
function cellText(c: ClientColumn, v: unknown): string {
  if (v == null || v === "") return "";
  switch (c.type) {
    case "boolean":
      return v ? "はい" : "いいえ";
    case "enum":
      return c.options?.find((o) => o.value === v)?.label ?? String(v);
    case "list":
    case "textlist":
      return Array.isArray(v) ? v.join(";") : String(v);
    case "map":
      return typeof v === "object" ? Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}:${x}`).join(";") : String(v);
    default:
      return String(v);
  }
}
/** 一覧の表示（参照は名前も出す） */
function show(c: ClientColumn, v: unknown, refs: RefIndex): string {
  const t = cellText(c, v);
  if (c.ref && t) {
    const r = refs[c.ref]?.find((x) => x.id === v);
    return r?.name ? `${r.id} ${r.name}` : t;
  }
  return t;
}

export function MasterClient({ name, label, columns, listKeys, keyColumns, hasStock, rows, refs }: {
  name: string; label: string; columns: ClientColumn[]; listKeys: string[]; keyColumns: string[]; hasStock: boolean; rows: Rec[]; refs: RefIndex;
}) {
  const router = useRouter();
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<{ id?: string; values: Record<string, string> } | null>(null);
  const [formErrors, setFormErrors] = useState<{ column: string; message: string }[]>([]);
  const [counting, setCounting] = useState<{ id: string; value: string } | null>(null);
  const [preview, setPreview] = useState<(Preview & { hash: string }) | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [showDisabled, setShowDisabled] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const listCols = listKeys.map((k) => columns.find((c) => c.key === k)).filter((c): c is ClientColumn => !!c);
  const get = (r: Rec, key: string) => r[key];
  const visible = rows.filter((r) => showDisabled || !r.disabled);

  async function post(body: Record<string, unknown> | FormData) {
    const res = await fetch(`/api/masters/${name}`, {
      method: "POST",
      ...(body instanceof FormData ? { body } : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error ?? "うまくいきませんでした");
    return d;
  }
  async function run<T>(fn: () => Promise<T>, okText?: (r: T) => string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (okText) setMsg({ ok: true, text: okText(r) });
      router.refresh();
      return r;
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  // ── CSV ──
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setFile(f);
    const fd = new FormData();
    fd.append("file", f);
    fd.append("action", "preview");
    run(async () => setPreview(await post(fd)));
  };
  const apply = () => {
    if (!file || !preview) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("action", "apply");
    fd.append("who", who);
    fd.append("hash", preview.hash);
    run(() => post(fd), (r: { added: number; updated: number }) => `${file.name} を登録しました（追加 ${r.added} 件・更新 ${r.updated} 件）`).then((r) => {
      if (r) {
        setPreview(null);
        setFile(null);
      }
    });
  };

  // ── 1件の編集 ──
  const openEdit = (r?: Rec) => {
    setFormErrors([]);
    setEditing({ id: r?.id, values: Object.fromEntries(columns.map((c) => [c.key, r ? cellText(c, r[c.key]) : ""])) });
  };
  const saveEdit = () =>
    editing &&
    run(async () => {
      const r = await post({ action: "save", id: editing.id, input: editing.values, who });
      if (!r.ok) {
        setFormErrors(r.errors);
        throw new Error("入力を直してください");
      }
      setEditing(null);
      return r;
    }, () => `${label}を保存しました`);

  const field = "min-h-12 w-full rounded-lg border-2 border-rule-strong bg-sheet px-3 text-base";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-sm font-bold text-ink-soft">
          操作する人
          <select className="min-h-12 rounded-lg border-2 border-rule-strong bg-sheet px-3 text-base text-ink" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">えらんでください</option>
            {STAFF.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <Button variant="primary" disabled={busy} onClick={() => openEdit()}>＋ {label}を1件追加</Button>
        <Button disabled={busy} onClick={() => fileInput.current?.click()}>CSV で一括登録</Button>
        <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" onChange={pick} />
        <a className={buttonClass("ghost")} href={`/api/masters/${name}?format=csv`}>CSV に書き出す</a>
        <a className={buttonClass("quiet")} href={`/api/masters/${name}?format=template`}>空のテンプレート</a>
        <label className="ml-auto flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={showDisabled} onChange={(e) => setShowDisabled(e.target.checked)} /> 使わなくなったものも出す
        </label>
      </div>
      {msg && <Notice tone={msg.ok ? "ok" : "alert"}>{msg.text}</Notice>}

      {/* CSV のプレビュー */}
      {preview && (
        <section className="space-y-3 rounded-lg border-2 border-crust-600 bg-sheet p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-black">読み込んだ CSV の確認：{preview.fileName}</h2>
            <span className="text-sm text-ink-soft">文字コード {preview.encoding === "shift_jis" ? "Shift_JIS" : "UTF-8"}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Tag tone="ok">追加 {preview.counts.add}</Tag>
            <Tag tone="info">更新 {preview.counts.update}</Tag>
            <Tag tone="plain">変化なし {preview.counts.same}</Tag>
            <Tag tone={preview.counts.error ? "alert" : "plain"}>エラー {preview.counts.error}</Tag>
          </div>
          {preview.fileErrors.map((e) => <Notice key={e} tone="alert">{e}</Notice>)}
          {preview.ignoredColumns.length > 0 && <p className="text-sm text-ink-soft">使わなかった列：{preview.ignoredColumns.join("・")}</p>}
          {preview.missingColumns.length > 0 && <p className="text-sm text-ink-soft">CSV に無い列（今の値のまま）：{preview.missingColumns.join("・")}</p>}
          <div className="max-h-[50vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-cream"><tr className="border-b-2 border-rule-strong text-left"><th className="py-1 pr-2">行</th><th className="pr-2">結果</th><th className="pr-2">ID</th><th>内容</th></tr></thead>
              <tbody>
                {preview.rows.filter((r) => r.kind !== "same").map((r) => (
                  <tr key={r.line} className={`border-t border-dashed border-rule align-top ${r.kind === "error" ? "bg-alert-bg" : ""}`}>
                    <td className="num py-1.5 pr-2">{r.line}</td>
                    <td className="pr-2 whitespace-nowrap">
                      <Tag tone={r.kind === "add" ? "ok" : r.kind === "update" ? "info" : "alert"}>{{ add: "追加", update: "更新", error: "エラー", same: "変化なし" }[r.kind]}</Tag>
                    </td>
                    <td className="num pr-2">{r.id ?? ""}</td>
                    <td>
                      {r.kind === "add" && <span>{String(r.record.name ?? r.record.label ?? r.record.header ?? "")}</span>}
                      {r.kind === "update" && r.changes.map((c) => <div key={c.column}>{c.column}：{c.before || "（空）"} → <b>{c.after || "（空）"}</b></div>)}
                      {r.kind === "error" && r.errors.map((e, i) => <div key={i} className="font-bold text-alert-ink">{e.column && `${e.column}：`}{e.message}</div>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ok" size="lg" disabled={busy || !preview.canApply || !who} onClick={apply}>
              {preview.canApply ? `この内容で登録する（追加 ${preview.counts.add}・更新 ${preview.counts.update}）` : preview.counts.error || preview.fileErrors.length ? "エラーを直した CSV を読み込み直してください" : "登録する変更がありません"}
              {preview.canApply && !who && "（操作する人をえらんでください）"}
            </Button>
            <Button variant="quiet" onClick={() => { setPreview(null); setFile(null); }}>やめる</Button>
          </div>
        </section>
      )}

      {/* 1件の編集 */}
      {editing && (
        <section className="space-y-3 rounded-lg border-2 border-crust-600 bg-sheet p-4">
          <h2 className="text-xl font-black">{editing.id ? `${label}を直す（${editing.id}）` : `${label}を追加`}</h2>
          {formErrors.map((e, i) => <Notice key={i} tone="alert">{e.column && `${e.column}：`}{e.message}</Notice>)}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {columns.filter((c) => !(editing.id && keyColumns.includes(c.key))).map((c) => (
              <label key={c.key} className="block text-sm font-bold text-ink-soft">
                {c.label}{c.required && <span className="ml-1 text-crust-700">（必ず入れる）</span>}
                {c.type === "enum" || c.type === "boolean" || c.ref ? (
                  <select className={field} value={editing.values[c.key] ?? ""} onChange={(e) => setEditing({ ...editing, values: { ...editing.values, [c.key]: e.target.value } })}>
                    <option value="">（なし）</option>
                    {c.type === "enum" && c.options?.map((o) => <option key={o.value} value={o.label}>{o.label}</option>)}
                    {c.type === "boolean" && ["はい", "いいえ"].map((o) => <option key={o}>{o}</option>)}
                    {c.ref && refs[c.ref]?.map((o) => <option key={o.id} value={o.id}>{o.id} {o.name ?? ""}</option>)}
                  </select>
                ) : (
                  <input
                    className={field}
                    inputMode={c.type === "number" || c.type === "integer" ? "decimal" : undefined}
                    placeholder={c.key === "id" ? "空なら自動で振ります" : (c.example ?? "")}
                    value={editing.values[c.key] ?? ""}
                    onChange={(e) => setEditing({ ...editing, values: { ...editing.values, [c.key]: e.target.value } })}
                  />
                )}
                {c.help && <span className="block text-xs font-normal">{c.help}</span>}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="ok" size="lg" disabled={busy || !who} onClick={saveEdit}>保存する{!who && "（操作する人をえらんでください）"}</Button>
            <Button variant="quiet" onClick={() => setEditing(null)}>やめる</Button>
          </div>
        </section>
      )}

      {/* 一覧 */}
      <section className="overflow-x-auto rounded-lg border border-rule bg-sheet">
        <table className="w-full min-w-[760px]">
          <thead>
            <tr className="border-b-2 border-rule-strong bg-cream text-left text-sm text-ink [&>th]:px-2 [&>th]:py-2 [&>th]:whitespace-nowrap">
              {listCols.map((c) => <th key={c.key} className={c.type === "number" || c.type === "integer" ? "text-right" : ""}>{c.label}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const low = hasStock && Number(r.stock ?? 0) < Number(r.safetyStock ?? 0);
              return (
                <tr key={r.id} className={`border-t border-dashed border-rule align-top [&>td]:px-2 [&>td]:py-2 [&>td]:whitespace-nowrap ${r.disabled ? "text-ink-faint line-through" : ""}`}>
                  {listCols.map((c) => (
                    <td key={c.key} className={`${c.type === "number" || c.type === "integer" ? "num text-right" : ""} ${c.key === "name" ? "font-bold" : ""}`}>
                      {c.key === "stock" && low && !r.disabled ? <Tag tone="review">{show(c, get(r, c.key), refs)}</Tag> : show(c, get(r, c.key), refs)}
                      {c.key === "stock" && typeof r.stockCountedAt === "string" && <div className="text-xs text-ink-soft no-underline">棚卸 {fmtDateTime(r.stockCountedAt)}</div>}
                    </td>
                  ))}
                  <td className="whitespace-nowrap text-right">
                    {r.disabled ? (
                      <Button variant="quiet" disabled={busy || !who} onClick={() => run(() => post({ action: "restore", id: r.id, who }), () => `${r.id} を戻しました`)}>戻す</Button>
                    ) : counting?.id === r.id ? (
                      <span className="inline-flex items-center gap-1">
                        <input autoFocus className="min-h-12 w-24 rounded-lg border border-rule-strong px-2 text-right" inputMode="decimal" value={counting.value} onChange={(e) => setCounting({ id: r.id, value: e.target.value })} />
                        <Button variant="ok" disabled={busy || !who || counting.value === ""} onClick={() => run(() => post({ action: "stocktake", id: r.id, counted: Number(counting.value), who }), (x: { before: number; after: number }) => `${r.name} の在庫を ${x.before} → ${x.after} にしました（棚卸）`).then((x) => x && setCounting(null))}>記録</Button>
                        <Button variant="quiet" onClick={() => setCounting(null)}>×</Button>
                      </span>
                    ) : (
                      <span className="inline-flex gap-1">
                        {hasStock && <Button variant="ghost" disabled={busy} onClick={() => setCounting({ id: r.id, value: String(r.stock ?? "") })}>棚卸</Button>}
                        <Button variant="ghost" disabled={busy} onClick={() => openEdit(r)}>直す</Button>
                        <Button variant="quiet" disabled={busy || !who} onClick={() => confirm(`${r.id} ${String(r.name ?? "")} を「使わない」にしますか？（記録は残り、あとで戻せます）`) && run(() => post({ action: "delete", id: r.id, who }), () => `${r.id} を使わないにしました`)}>使わない</Button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      {!who && <p className="text-sm text-ink-soft">保存・棚卸・CSV の登録には「操作する人」をえらんでください（誰が変えたかを記録します）。</p>}
    </div>
  );
}
