"use client";
// 外部の入口の取り込みボタン（確認用の最小限の画面。きれいな画面は②が作る）
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass, Notice } from "@/components/ui";

type Channel = "email" | "sheet" | "kirara" | "infomart";

interface Props {
  samples: { email: string[]; kirara: string[]; infomart: string[] };
}

export function ImportPanel({ samples }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ title: string; data: unknown } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState({ url: "", sheetName: "", range: "", customerId: "C13", place: "" });

  async function run(channel: Channel, title: string, body: Record<string, unknown> | FormData) {
    setBusy(title);
    setError(null);
    try {
      const res = await fetch(`/api/import/${channel}`, {
        method: "POST",
        ...(body instanceof FormData ? { body } : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "取り込みに失敗しました");
      setResult({ title, data });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const upload = (channel: Channel) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    run(channel, f.name, fd);
    e.target.value = "";
  };

  const btn = buttonClass("primary");
  const sub = buttonClass("ghost", "md", "text-sm");
  const input = "min-h-12 rounded-lg border border-rule-strong bg-sheet px-3";
  const fileCls = "block text-sm text-ink-soft file:mr-3 file:min-h-12 file:rounded-lg file:border file:border-rule-strong file:bg-sheet file:px-4 file:font-bold file:text-ink";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <section className="card space-y-2 p-4">
          <h2 className="text-lg font-black">メール注文（本文・PDF・Excel）</h2>
          <p className="text-sm text-ink-soft">Claude が本文と添付を読み、要確認の注文にします。変更・キャンセルは元の注文を書き換えず、別の「変更」として入ります。</p>
          <div className="flex flex-wrap gap-2">
            {samples.email.map((s) => (
              <button key={s} className={sub} disabled={!!busy} onClick={() => run("email", s, { sample: s })}>
                {s.replace(/\.eml$/, "")}
              </button>
            ))}
          </div>
          <label className={fileCls}>
            .eml ファイルを選ぶ <input className="mt-1 block" type="file" accept=".eml" onChange={upload("email")} disabled={!!busy} />
          </label>
        </section>

        <section className="card space-y-2 p-4">
          <h2 className="text-lg font-black">Google スプレッドシート</h2>
          <p className="text-sm text-ink-soft">店舗別・月別のシート（行＝納品日、列＝商品、セル＝ケース数）を読み、前回とのちがいを出します。</p>
          <div className="flex flex-wrap gap-2">
            <button className={sub} disabled={!!busy} onClick={() => run("sheet", "シート 1回目", { sample: "v1" })}>デモ: 1回目を読む</button>
            <button className={sub} disabled={!!busy} onClick={() => run("sheet", "シート 2回目（本部が書き換えた後）", { sample: "v2" })}>デモ: 書き換え後を読む</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input className={`col-span-2 ${input}`} placeholder="シートの URL" value={sheet.url} onChange={(e) => setSheet({ ...sheet, url: e.target.value })} />
            <input className={input} placeholder="シート名" value={sheet.sheetName} onChange={(e) => setSheet({ ...sheet, sheetName: e.target.value })} />
            <input className={input} placeholder="範囲（例 A1:H40）" value={sheet.range} onChange={(e) => setSheet({ ...sheet, range: e.target.value })} />
            <input className={input} placeholder="得意先ID（例 C13）" value={sheet.customerId} onChange={(e) => setSheet({ ...sheet, customerId: e.target.value })} />
            <input className={input} placeholder="納品先（店舗名）" value={sheet.place} onChange={(e) => setSheet({ ...sheet, place: e.target.value })} />
          </div>
          <button className={btn} disabled={!!busy || !sheet.url} onClick={() => run("sheet", sheet.sheetName, sheet)}>このシートを読む</button>
        </section>

        <section className="card space-y-2 p-4">
          <h2 className="text-lg font-black">得意先の専用サイト（CSV）</h2>
          <p className="text-sm text-ink-soft">あおい医療フードサービスの発注サイトから落とした CSV を入れると、事業所ごとの注文と、振り分け表（仕入先への本発注・前日分・自社製造・包装・菓子パン）を作ります。</p>
          <div className="flex flex-wrap gap-2">
            {samples.kirara.map((s) => (
              <button key={s} className={sub} disabled={!!busy} onClick={() => run("kirara", s, { sample: s })}>{s}</button>
            ))}
          </div>
          <label className={fileCls}>
            CSV を選ぶ <input className="mt-1 block" type="file" accept=".csv" onChange={upload("kirara")} disabled={!!busy} />
          </label>
        </section>

        <section className="card space-y-2 p-4">
          <h2 className="text-lg font-black">インフォマート（受注 CSV）</h2>
          <p className="text-sm text-ink-soft">受注明細の CSV を取り込みます（いまは架空の形。実物の形は画面調査で合わせます）。</p>
          <div className="flex flex-wrap gap-2">
            {samples.infomart.map((s) => (
              <button key={s} className={sub} disabled={!!busy} onClick={() => run("infomart", s, { sample: s })}>{s}</button>
            ))}
          </div>
          <label className={fileCls}>
            CSV を選ぶ <input className="mt-1 block" type="file" accept=".csv" onChange={upload("infomart")} disabled={!!busy} />
          </label>
        </section>
      </div>

      {busy && <Notice tone="info">取り込み中: {busy}（メールは Claude が読むので少し時間がかかります）</Notice>}
      {error && <Notice tone="alert">{error}</Notice>}
      {result && <ResultView title={result.title} data={result.data} />}
    </div>
  );
}

function ResultView({ title, data }: { title: string; data: unknown }) {
  const d = data as Record<string, unknown>;
  return (
    <section className="card space-y-3 p-4">
      <h2 className="text-lg font-black">取り込み結果: {title}</h2>
      {"intent" in d && (
        <p>
          種類: <b>{({ new: "新しい注文", change: "変更", cancel: "キャンセル", not_order: "注文ではない" } as Record<string, string>)[d.intent as string]}</b>
          {d.changeOf ? <> ／ 元の注文: <code>{String(d.changeOf)}</code>（元の注文は書き換えていません）</> : null}
        </p>
      )}
      {Array.isArray(d.diffs) && (
        <div>
          <p className="font-bold">{d.firstTime ? "はじめて読みました（次から、前回とのちがいが出ます）" : `前回とのちがい ${(d.diffs as unknown[]).length} か所`}</p>
          <ul className="mt-1 space-y-0.5">
            {(d.diffs as { date: string; column: string; before: number | null; after: number | null }[]).map((x, i) => (
              <li key={i}>
                <span className="num">{x.date}</span> {x.column}：<span className="num">{x.before ?? "なし"}</span> → <b className="num">{x.after ?? "なし"}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
      {Array.isArray(d.routing) && (
        <div className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="border-b border-rule-strong text-left text-sm text-ink-soft [&>th]:py-1.5 [&>th]:pr-3">
              <th>振り分け先</th><th>行き先（便・届く日）</th><th>品目</th><th className="text-right">パック</th><th className="text-right">個数</th><th className="text-right">前回との差</th>
            </tr>
          </thead>
          <tbody>
            {(d.routing as { destLabel: string; route: string; shortName: string; packs: number; pieces: number; diff: number | null; productId: string }[]).map((r, i) => (
              <tr key={i} className={`border-t border-dashed border-rule [&>td]:py-1.5 [&>td]:pr-3 ${r.productId ? "" : "bg-review-bg"}`}>
                <td className="font-bold">{r.destLabel}</td><td className="text-sm">{r.route}</td><td>{r.shortName}</td><td className="num text-right font-black">{r.packs}</td><td className="num text-right">{r.pieces}</td>
                <td className={`num text-right ${r.diff ? "font-bold text-alert-ink" : ""}`}>{r.diff == null ? "—" : r.diff > 0 ? `+${r.diff}` : r.diff}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {Array.isArray(d.orderIds) && <p className="font-bold">受注一覧に「要確認」で入った注文：<span className="num text-xl">{(d.orderIds as string[]).length}</span> 件</p>}
      <details>
        <summary className="cursor-pointer text-sm text-ink-soft">中身をすべて見る</summary>
        <pre className="max-h-96 overflow-auto rounded border border-rule bg-paper p-2 text-xs">{JSON.stringify(data, null, 2)}</pre>
      </details>
    </section>
  );
}
