"use client";
// 製造の実績（⑤）。その日の製造を作り終えたら、作った数を確かめて「作り終えた」を押す。
// 押すと、レシピ×作った数（ロス込み）で材料を、商品の包材で包材を、在庫から引く（⑤の stock・③の計算）。
// 数を直してもう一度押すと、前の記録との差だけ在庫を動かす。
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, fmtDateTime, Notice } from "@/components/ui";

import type { Actual, MadeView } from "./made";
export type { MadeView };

const STAFF = ["こばやし", "たなか", "はやし"];

export function ProductionDone({ date, planned, actual }: { date: string; planned: MadeView[]; actual?: Actual }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(planned.map((p) => [p.productId, String(actual?.made.find((m) => m.productId === p.productId)?.pieces ?? (actual ? 0 : p.pieces))])),
  );
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!planned.length) return null;
  const bad = planned.some((p) => !(Number(values[p.productId]) >= 0) || values[p.productId] === "");

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/stock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "produce", date, who, made: planned.map((p) => ({ productId: p.productId, pieces: Number(values[p.productId]) })) }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      setMsg({ ok: true, text: j.moves.length ? `在庫から ${j.moves.length} 品を引きました。` : "変わったところはありません。" });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded-lg border border-rule bg-sheet print:hidden" open={!actual}>
      <summary className="flex min-h-12 cursor-pointer items-center px-4 font-bold text-ink-soft">
        {actual ? `製造の実績（記録済み ${fmtDateTime(actual.at)}・${actual.who}）` : "作り終えたら：製造の実績を記録する（材料・包材の在庫から引く）"}
      </summary>
      <div className="space-y-3 px-4 pb-4">
        <table className="w-full text-base">
          <thead>
            <tr className="border-b border-rule-strong text-left text-sm text-ink-soft"><th className="py-1">商品</th><th className="text-right">計画</th><th className="text-right">作った数</th></tr>
          </thead>
          <tbody>
            {planned.map((p) => (
              <tr key={p.productId} className="border-t border-dashed border-rule">
                <td className="py-1.5">{p.name}</td>
                <td className="num text-right text-ink-soft">{p.pieces}</td>
                <td className="text-right">
                  <input className="num min-h-12 w-28 rounded-lg border border-rule-strong bg-sheet px-3 text-right text-base" inputMode="numeric" aria-label={`${p.name} の作った数`}
                    value={values[p.productId]} onChange={(e) => setValues((v) => ({ ...v, [p.productId]: e.target.value }))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {actual && (
          <p className="text-sm text-ink-soft">
            引いた量：{[...actual.usage.materials, ...actual.usage.packaging].map((u) => `${u.name} ${u.qty}${u.unit}`).join("・") || "なし"}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <select className="min-h-12 rounded-lg border border-rule-strong bg-sheet px-3 text-base" value={who} onChange={(e) => setWho(e.target.value)} aria-label="記録する人">
            <option value="">記録する人をえらぶ</option>
            {STAFF.map((s) => <option key={s}>{s}</option>)}
          </select>
          <Button variant="primary" disabled={busy || !who || bad} onClick={save}>{actual ? "実績の数を直す" : "作り終えた（在庫から引く）"}</Button>
        </div>
        {msg && <Notice tone={msg.ok ? "ok" : "alert"}>{msg.text}</Notice>}
      </div>
    </details>
  );
}
