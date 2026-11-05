"use client";
// レシピの親子の編集（⑤）。生地を選ぶ → 材料の行を足す・％を入れる → 合計と粉の合計を見て保存。
// 保存は /api/masters/recipeItems（action: saveRecipe）。CSV と同じ検証をサーバーでして、エラーがあれば何も保存しない。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Notice } from "@/components/ui";
import { isFlourName, recipeSummary } from "@/lib/masters/recipe";

export interface RecipeDough {
  id: string;
  name: string;
  line: string;
  lossRate: number;
  items: { materialId: string; percent: string }[];
  steps: { id: string; seq: number; name: string; equipment?: string; people: number; ccp: boolean; prevDay: boolean }[];
}
type Material = { id: string; name: string; unit: string };
const STAFF = ["こばやし", "たなか", "はやし"];
const inputClass = "min-h-12 rounded-lg border-2 border-rule-strong bg-sheet px-3 text-base text-ink";

export function RecipeClient({ doughs, materials, selected, batchKg }: { doughs: RecipeDough[]; materials: Material[]; selected?: string; batchKg?: number }) {
  const router = useRouter();
  const [doughId, setDoughId] = useState(selected ?? "");
  const dough = doughs.find((d) => d.id === doughId);
  const [rows, setRows] = useState(dough?.items ?? []);
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const [kg, setKg] = useState(String(batchKg ?? 10));
  const [msg, setMsg] = useState<{ ok: boolean; text: string[] } | null>(null);

  const choose = (id: string) => {
    setDoughId(id);
    setRows(doughs.find((d) => d.id === id)?.items ?? []);
    setMsg(null);
    router.replace(`/masters/recipes?dough=${id}`, { scroll: false });
  };
  const isFlour = (id: string) => isFlourName(materials.find((m) => m.id === id)?.name ?? "");
  const set = (i: number, patch: Partial<{ materialId: string; percent: string }>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const sum = recipeSummary(rows, materials);
  const changed = JSON.stringify(rows) !== JSON.stringify(dough?.items ?? []);
  // 仕込む生地 kg から、材料ごとの kg（生産計画と同じ式: 粉kg = 生地kg ÷ (合計％/100)）
  const doughKg = Number(kg) > 0 ? Number(kg) : 0;
  const flourKg = sum.total > 0 ? doughKg / (sum.total / 100) : 0;

  async function save() {
    if (!who) return setMsg({ ok: false, text: ["操作する人を選んでください"] });
    setBusy(true);
    try {
      const res = await fetch("/api/masters/recipeItems", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "saveRecipe", doughId, lines: rows, who }),
      });
      const j = await res.json();
      if (!res.ok) setMsg({ ok: false, text: [j.error ?? "保存できませんでした"] });
      else if (!j.ok) setMsg({ ok: false, text: j.errors.map((e: { line: number; column: string; message: string }) => `${e.line ? `${e.line}行目 ` : ""}${e.column}：${e.message}`) });
      else {
        setMsg({ ok: true, text: [`保存しました（${j.saved}行${j.removed ? `・${j.removed}行を使わないに` : ""}）。生産計画はこの配合で計算します。`] });
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/masters/recipes" className="inline-flex min-h-12 items-center font-bold text-crust-700 underline underline-offset-4">‹ レシピのカードにもどる</Link>
        <label className="ml-auto flex items-center gap-2 text-sm font-bold text-ink-soft">
          ほかの生地
          <select className={inputClass} value={doughId} onChange={(e) => choose(e.target.value)} disabled={changed}>
            {doughs.map((d) => <option key={d.id} value={d.id}>{d.name}（{d.id}）</option>)}
          </select>
        </label>
      </div>

      {dough && (
        <section id="edit" className="space-y-4 rounded-lg border-2 border-rule-strong bg-sheet p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-black">{dough.name} の配合を直す</h2>
            <span className="text-sm text-ink-soft">ライン {dough.line === "pizza" ? "ピザ" : "パン"}・ロス率 {Math.round(dough.lossRate * 1000) / 10}%</span>
          </div>
          <table className="w-full text-base">
            <thead>
              <tr className="border-b-2 border-rule-strong text-left text-sm text-ink-soft [&>th]:whitespace-nowrap">
                <th className="py-1 pr-2">材料</th><th className="pr-2 text-right">ベーカーズ％</th><th className="pr-2 text-right">生地 {doughKg || "-"}kg なら（g）</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={`border-t border-dashed border-rule ${isFlour(r.materialId) ? "font-black" : ""}`}>
                  <td className="py-1.5 pr-2">
                    <select className={`${inputClass} w-full`} value={r.materialId} onChange={(e) => set(i, { materialId: e.target.value })} aria-label={`${i + 1}行目の材料`}>
                      <option value="">材料をえらぶ</option>
                      {materials.map((m) => <option key={m.id} value={m.id}>{m.id} {m.name}</option>)}
                    </select>
                  </td>
                  <td className="pr-2 text-right">
                    <input className={`${inputClass} num w-28 text-right ${isFlour(r.materialId) ? "font-black" : ""}`} inputMode="decimal" value={r.percent} onChange={(e) => set(i, { percent: e.target.value })} aria-label={`${i + 1}行目の％`} />
                  </td>
                  <td className="num pr-2 text-right">
                    {flourKg && Number(r.percent) ? `${Math.round(flourKg * Number(r.percent) * 10).toLocaleString("ja-JP")} g` : ""}
                  </td>
                  <td className="text-right"><Button variant="quiet" className="whitespace-nowrap" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>行を消す</Button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-rule-strong font-bold">
                <td className="py-2 pr-2">合計（粉の合計 <span className="num">{sum.flour}</span>%）</td>
                <td className="num pr-2 text-right">{sum.total}%</td>
                <td className="num pr-2 text-right">{doughKg ? `${(doughKg * 1000).toLocaleString("ja-JP")} g` : ""}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => setRows((rs) => [...rs, { materialId: "", percent: "" }])}>＋ 材料の行を足す</Button>
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              g の計算は 生地
              <input className={`${inputClass} num w-24 text-right`} inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} />kg（ミキサー1回分）で
            </label>
          </div>
          {sum.warnings.map((w) => <Notice key={w} tone="review">{w}</Notice>)}
          {msg && <Notice tone={msg.ok ? "ok" : "alert"}>{msg.text.map((t) => <div key={t}>{t}</div>)}</Notice>}
          {/* 保存は画面の下に固定（ボタンは1つ） */}
          <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-3 border-t-2 border-crust-600 bg-sheet/95 px-4 py-3 backdrop-blur">
            <span className={`text-sm font-bold ${changed ? "text-review-ink" : "text-ink-soft"}`}>{changed ? "直したところがあります" : "変更はありません"}</span>
            <label className="flex items-center gap-2 text-sm font-bold text-ink-soft">
              操作する人
              <select className={`${inputClass} ${who ? "" : "border-review-line bg-review-bg"}`} value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="">えらんでください</option>
                {STAFF.map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
            <Button variant="primary" size="lg" disabled={busy || !changed} onClick={save}>この配合で保存</Button>
            {changed && <Button variant="quiet" disabled={busy} onClick={() => setRows(dough.items)}>元に戻す</Button>}
          </div>
        </section>
      )}

      {dough && (
        <details className="rounded-lg border border-rule bg-sheet px-4">
          <summary className="flex min-h-12 cursor-pointer items-center font-bold text-crust-700 underline underline-offset-4">{dough.name} の工程を見る（{dough.steps.length}）</summary>
          <div className="space-y-2 pb-3">
          {dough.steps.length ? (
            <ol className="space-y-1">
              {dough.steps.map((s) => (
                <li key={s.id} className="flex flex-wrap gap-x-3 border-b border-dashed border-rule py-1.5">
                  <span className="num w-8 text-ink-soft">{s.seq}</span>
                  <span className="font-bold">{s.name}</span>
                  {s.equipment && <span className="text-ink-soft">{s.equipment}</span>}
                  <span className="text-ink-soft">{s.people}人</span>
                  {s.prevDay && <span className="text-ink-soft">前日</span>}
                  {s.ccp && <span className="font-bold text-alert-ink">CCP</span>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-ink-soft">工程がまだありません。</p>
          )}
          <p className="text-sm"><Link className="underline" href="/masters/steps">工程を足す・直す（工程マスタ）</Link></p>
          </div>
        </details>
      )}
    </div>
  );
}
