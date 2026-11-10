"use client";
// 衛生管理マニュアルの一覧と登録（⑦の(21)）。
import { useState, useTransition } from "react";
import { buttonClass } from "@/components/ui";
import type { Manual } from "@/lib/hygiene/store";
import { useRouter } from "next/navigation";
import { deleteManualAction } from "../actions";

const CATEGORIES = ["一般衛生管理", "HACCP・CCP", "清掃・洗浄", "温度管理", "異物混入の防止", "従業員の衛生", "記録の見本", "その他"];
const field = "min-h-14 w-full rounded-lg border-2 border-rule-strong bg-sheet px-3 text-lg";
const kindOf = (m: Manual) => (/pdf/.test(m.mime) || /\.pdf$/i.test(m.fileName) ? "PDF" : /image/.test(m.mime) ? "画像" : /sheet|excel|\.xls/i.test(m.mime + m.fileName) ? "Excel" : /word|\.doc/i.test(m.mime + m.fileName) ? "Word" : "ファイル");
const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

export function ManualsClient({ manuals }: { manuals: Manual[] }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const router = useRouter();
  const groups = CATEGORIES.concat([...new Set(manuals.map((m) => m.category))].filter((c) => !CATEGORIES.includes(c)))
    .map((c) => ({ c, list: manuals.filter((m) => m.category === c) }))
    .filter((g) => g.list.length);
  return (
    <div className="space-y-8">
      {groups.length === 0 && <p className="card p-6 text-xl">まだ登録がありません。下の「マニュアルを登録する」から入れてください。</p>}
      {groups.map((g) => (
        <section key={g.c}>
          <h2 className="mb-2 text-2xl font-bold">{g.c}</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {g.list.map((m) => (
              <li key={m.id} className="card flex flex-col gap-2 p-4">
                <p className="text-xl font-bold">{m.name}</p>
                <p className="text-lg text-ink-soft">
                  {kindOf(m)}・{size(m.size)}
                  {m.version ? `・${m.version}` : ""}・{new Date(m.uploadedAt).toLocaleDateString("ja-JP")} {m.uploadedBy}
                </p>
                {m.note && <p className="text-lg">{m.note}</p>}
                <div className="mt-auto flex flex-wrap gap-3">
                  <a href={`/api/hygiene/manuals/${m.id}`} target="_blank" rel="noreferrer" className="btn-primary text-lg">
                    開く（印刷）
                  </a>
                  <a href={`/api/hygiene/manuals/${m.id}?download=1`} className="btn-ghost text-lg">
                    保存する
                  </a>
                  {confirmId === m.id ? (
                    <>
                      <button type="button" className={buttonClass("ghost", "md")} disabled={pending} onClick={() => start(async () => { await deleteManualAction(m.id); setConfirmId(null); })}>
                        本当に消す
                      </button>
                      <button type="button" className={buttonClass("quiet", "md")} onClick={() => setConfirmId(null)}>
                        やめる
                      </button>
                    </>
                  ) : (
                    <button type="button" className={buttonClass("quiet", "md")} onClick={() => setConfirmId(m.id)}>
                      消す
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="card space-y-4 p-5">
        <h2 className="text-2xl font-bold">マニュアルを登録する</h2>
        <div className="rounded-lg border-2 border-info-line bg-info-bg p-4 text-lg text-info-ink">
          <p className="font-bold">登録はこうしたらできます</p>
          <ol className="mt-1 list-decimal space-y-1 pl-6">
            <li>「ファイルを選ぶ」を押して、マニュアルのファイルを選びます（PDF・Excel・Word・写真。10MB まで）。紙しか無いものは、スマホで写真を撮るか、複合機でスキャンして PDF にします。</li>
            <li>名前（例: 手洗いの手順）と分類を選びます。版（例: 2026年4月改訂）を入れておくと、新しい版と見分けられます。</li>
            <li>「登録する」を押すと、上の一覧に出ます。押すと開き、印刷の画面から紙に出せます。</li>
            <li>新しい版にしたら、新しいファイルを登録して、古いものは「消す」。</li>
          </ol>
        </div>
        <form
          action={(fd) =>
            start(async () => {
              const res = await fetch("/api/hygiene/manuals", { method: "POST", body: fd });
              const r = (await res.json().catch(() => ({ ok: false, error: "登録できませんでした（ファイルが大きすぎるかもしれません）" }))) as { ok: boolean; error?: string };
              setMsg(r.ok ? { ok: true, text: "登録しました" } : { ok: false, text: r.error ?? "登録できませんでした" });
              if (r.ok) router.refresh();
            })
          }
          className="grid gap-4 md:grid-cols-2"
        >
          <label className="flex flex-col gap-1 text-lg font-bold md:col-span-2">
            ファイル
            <input type="file" name="file" required accept=".pdf,.xlsx,.xlsm,.xls,.docx,.doc,.png,.jpg,.jpeg,.gif,.webp,.heic" className="text-lg" />
          </label>
          <label className="flex flex-col gap-1 text-lg font-bold">
            名前（空ならファイルの名前）
            <input name="name" className={field} placeholder="例: 手洗いの手順" />
          </label>
          <label className="flex flex-col gap-1 text-lg font-bold">
            分類
            <select name="category" className={field} defaultValue="一般衛生管理">
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-lg font-bold">
            版・日付
            <input name="version" className={field} placeholder="例: 2026年4月改訂" />
          </label>
          <label className="flex flex-col gap-1 text-lg font-bold">
            登録する人
            <input name="who" className={field} placeholder="名前" />
          </label>
          <label className="flex flex-col gap-1 text-lg font-bold md:col-span-2">
            メモ
            <input name="note" className={field} placeholder="例: 視察のときに最初に見せる" />
          </label>
          <div className="flex items-center gap-4 md:col-span-2">
            <button type="submit" className={buttonClass("primary", "lg")} disabled={pending}>
              登録する
            </button>
            {msg && <span className={`text-xl ${msg.ok ? "text-ok-ink" : "font-bold text-alert-ink"}`}>{msg.text}</span>}
          </div>
        </form>
      </section>
    </div>
  );
}
