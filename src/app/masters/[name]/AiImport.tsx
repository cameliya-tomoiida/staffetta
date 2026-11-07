"use client";
// AI で取り込む（⑧）。どんな形の CSV・Excel でも、Claude が列を振り分けて「こう整えました」を見せる → 人が直して OK → 試す → 入れる。
// 一度 OK した対応は覚えて、次から同じ形のファイルで自動で使う（「覚えた対応」と出る）。
import { useRef, useState } from "react";
import { Button, Notice, Tag } from "@/components/ui";
import type { Preview } from "@/lib/masters/csv";
import { needsLook, type Mapping } from "@/lib/masters/ai-mapping";

interface Suggestion {
  mapping: Mapping;
  sample: string[][];
  shaped: { header: string[]; rows: string[][] };
  totalRows: number;
  filled?: string[];
  aiUsed?: boolean;
  aiError?: string;
}

const SOURCE_LABEL = { remembered: "前に OK した対応（覚え）", ai: "AI（Claude）が判断", rules: "見出しの名前から（AI は使っていません）" } as const;

export function AiImport({ name, label, columns, who, onClose, onDone }: {
  name: string;
  label: string;
  columns: { key: string; label: string }[];
  who: string;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [s, setS] = useState<Suggestion | null>(null);
  const [tried, setTried] = useState<(Preview & { hash: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const call = async (action: string, f: File, mapping?: Mapping) => {
    const fd = new FormData();
    fd.append("file", f);
    fd.append("action", action);
    if (mapping) fd.append("mapping", JSON.stringify(mapping));
    if (action === "ai_apply") fd.append("who", who);
    const res = await fetch(`/api/masters/${name}`, { method: "POST", body: fd });
    const j = await res.json();
    if (!res.ok || j.error) throw new Error(j.error ?? "うまくいきませんでした");
    return j.result ?? j;
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setFile(f);
    setTried(null);
    run(async () => setS(await call("ai_suggest", f)));
  };
  // 人が直した対応で、見本を作り直す
  const change = (m: Mapping) =>
    file && s &&
    run(async () => {
      setTried(null);
      const v = await call("ai_reshape", file, m);
      setS({ ...s, ...v });
    });
  const setCol = (source: number, target: string | null) =>
    s && change({ ...s.mapping, source: s.mapping.source, columns: s.mapping.columns.map((c) => (c.source === source ? { ...c, target, confidence: 1, reason: target ? "人が決めた" : "人が「使わない」にした" } : c)) });
  const tryIt = () => file && s && run(async () => setTried(await call("ai_try", file, s.mapping)));
  const apply = () =>
    file && s &&
    run(async () => {
      if (!who) throw new Error("上の「操作する人」を選んでください");
      const r = (await call("ai_apply", file, s.mapping)) as { added: number; updated: number; backup: string };
      onDone(`${file.name} を AI で整えて登録しました（追加 ${r.added} 件・更新 ${r.updated} 件）。この形のファイルは次から自動で振り分けます。DB のコピー: ${r.backup}`);
    });

  const looks = s?.mapping.columns.filter(needsLook).length ?? 0;
  const cell = "border border-rule px-2 py-1 align-top";
  return (
    <section className="space-y-3 rounded-lg border-2 border-crust-600 bg-sheet p-4">
      <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,text/csv" className="hidden" onChange={pick} />
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-black">AI で取り込む（{label}）</h2>
        <span className="ml-auto" />
        <Button variant="ghost" onClick={onClose}>やめる</Button>
      </div>
      <p className="text-base text-ink-soft">
        弥生などから出した CSV・Excel を、形をそろえずにそのまま選んでください。Claude が列の中身を見て振り分け、「こう整えました」を出します。直してから「試す」→「入れる」。入れる前に DB のコピーを取ります。
      </p>
      <Button variant="primary" disabled={busy} onClick={() => fileRef.current?.click()}>{file ? "ほかのファイルを選ぶ" : "ファイルを選ぶ（CSV・Excel）"}</Button>
      {busy && <p className="text-base font-bold">読んでいます…</p>}
      {err && <Notice tone="alert">{err}</Notice>}

      {s && file && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone={s.mapping.source === "remembered" ? "ok" : s.mapping.source === "ai" ? "info" : "plain"}>{SOURCE_LABEL[s.mapping.source]}</Tag>
            <span className="text-sm">{file.name}・データ {s.totalRows} 行</span>
            {looks > 0 && <Tag tone="review">迷った列 {looks}</Tag>}
          </div>
          {s.aiError && <Notice tone="review">AI が使えなかったので、見出しの名前から振り分けました（{s.aiError}）</Notice>}
          {s.mapping.note && <p className="text-base"><b>AI の見立て：</b>{s.mapping.note}</p>}
          {!!s.filled?.length && <p className="text-base"><b>ファイルに無いので入れた項目：</b>{s.filled.join("・")}（あとで直せます）</p>}
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">見出しの行（上から）
              <input type="number" min={1} max={20} value={s.mapping.headerStart + 1} onChange={(e) => change({ ...s.mapping, headerStart: Math.max(0, Number(e.target.value) - 1) })} className="min-h-10 w-16 rounded border-2 border-rule-strong bg-sheet px-2" />
              行目から
            </label>
            <label className="flex items-center gap-2">
              <input type="number" min={1} max={3} value={s.mapping.headerRows} onChange={(e) => change({ ...s.mapping, headerRows: Math.min(3, Math.max(1, Number(e.target.value))) })} className="min-h-10 w-14 rounded border-2 border-rule-strong bg-sheet px-2" />
              行ぶん
            </label>
          </div>

          <h3 className="text-lg font-black">振り分けた結果（列ごと）</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="bg-paper text-left">
                  <th className={cell}>元の見出し</th>
                  <th className={cell}>中身の例</th>
                  <th className={cell}>入れる所</th>
                  <th className={cell}>理由</th>
                  <th className={`${cell} text-right`}>自信</th>
                </tr>
              </thead>
              <tbody>
                {s.mapping.columns.map((c) => (
                  <tr key={c.source} className={needsLook(c) ? "bg-review-bg" : c.target ? "" : "text-ink-faint"}>
                    <td className={`${cell} font-bold`}>{c.header || `（${c.source + 1}列目・見出しなし）`}</td>
                    <td className={cell}>{s.sample.slice(0, 3).map((r) => r[c.source]).filter(Boolean).join("／").slice(0, 60)}</td>
                    <td className={cell}>
                      <select value={c.target ?? ""} onChange={(e) => setCol(c.source, e.target.value || null)} disabled={busy} className="min-h-10 rounded border-2 border-rule-strong bg-sheet px-2 text-ink">
                        <option value="">使わない</option>
                        {columns.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                      </select>
                      {(c.transforms.length > 0 || c.prefix) && <div className="mt-0.5 text-xs text-ink-soft">直し方: {[...c.transforms, ...(c.prefix ? [`頭に「${c.prefix}」`] : [])].join("・")}</div>}
                    </td>
                    <td className={cell}>{c.reason}</td>
                    <td className={`${cell} num text-right`}>{c.target || c.confidence ? `${Math.round(c.confidence * 100)}%` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="text-lg font-black">こう整えました（先頭の {s.shaped.rows.length} 行）</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead><tr className="bg-paper text-left">{s.shaped.header.map((h) => <th key={h} className={cell}>{h}</th>)}</tr></thead>
              <tbody>{s.shaped.rows.map((r, i) => <tr key={i}>{r.map((v, k) => <td key={k} className={cell}>{v}</td>)}</tr>)}</tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={busy} onClick={tryIt}>試す（まだ入れません）</Button>
            {tried && (
              <>
                <Tag tone="ok">追加 {tried.counts.add}</Tag>
                <Tag tone="info">更新 {tried.counts.update}</Tag>
                <Tag tone="plain">変化なし {tried.counts.same}</Tag>
                <Tag tone={tried.counts.error ? "alert" : "plain"}>エラー {tried.counts.error}</Tag>
                <Button variant="primary" disabled={busy || !tried.canApply} onClick={apply}>
                  {tried.canApply ? `入れる（追加 ${tried.counts.add}・更新 ${tried.counts.update}）` : "エラーを直してください"}
                </Button>
              </>
            )}
          </div>
          {tried && (tried.fileErrors.length > 0 || tried.counts.error > 0) && (
            <ul className="space-y-1 text-sm text-alert-ink">
              {tried.fileErrors.map((e) => <li key={e}>{e}</li>)}
              {tried.rows.filter((r) => r.kind === "error").slice(0, 10).map((r) => (
                <li key={r.line}>{r.line}行目: {"errors" in r ? r.errors.map((x) => x.message).join("・") : ""}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
