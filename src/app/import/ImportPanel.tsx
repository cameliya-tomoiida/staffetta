"use client";
// 外部の入口の取り込みボタン（確認用の最小限の画面。きれいな画面は②が作る）
import { useRouter } from "next/navigation";
import { useState } from "react";

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

  const btn = "rounded-lg bg-crust-600 px-3 py-2 text-sm font-bold text-white hover:bg-crust-700 disabled:opacity-40";
  const sub = "rounded-lg border border-black/15 px-3 py-2 text-sm font-bold hover:bg-crust-100 disabled:opacity-40";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <section className="card space-y-2 p-4">
          <h2 className="font-black">メール注文（本文・PDF・Excel）</h2>
          <p className="text-sm text-black/60">Claude が本文と添付を読み、要確認の注文にします。変更・キャンセルは元の注文を書き換えず、別の「変更」として入ります。</p>
          <div className="flex flex-wrap gap-2">
            {samples.email.map((s) => (
              <button key={s} className={sub} disabled={!!busy} onClick={() => run("email", s, { sample: s })}>
                {s.replace(/\.eml$/, "")}
              </button>
            ))}
          </div>
          <label className="block text-sm">
            .eml ファイルを選ぶ <input type="file" accept=".eml" onChange={upload("email")} disabled={!!busy} />
          </label>
        </section>

        <section className="card space-y-2 p-4">
          <h2 className="font-black">Google スプレッドシート</h2>
          <p className="text-sm text-black/60">店舗別・月別のシート（行＝納品日、列＝商品、セル＝ケース数）を読み、前回との差分を出します。</p>
          <div className="flex flex-wrap gap-2">
            <button className={sub} disabled={!!busy} onClick={() => run("sheet", "シート 1回目", { sample: "v1" })}>デモ: 1回目を読む</button>
            <button className={sub} disabled={!!busy} onClick={() => run("sheet", "シート 2回目（本部が書き換えた後）", { sample: "v2" })}>デモ: 書き換え後を読む</button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <input className="col-span-2 rounded border px-2 py-1" placeholder="シートの URL" value={sheet.url} onChange={(e) => setSheet({ ...sheet, url: e.target.value })} />
            <input className="rounded border px-2 py-1" placeholder="シート名" value={sheet.sheetName} onChange={(e) => setSheet({ ...sheet, sheetName: e.target.value })} />
            <input className="rounded border px-2 py-1" placeholder="範囲（例 A1:H40）" value={sheet.range} onChange={(e) => setSheet({ ...sheet, range: e.target.value })} />
            <input className="rounded border px-2 py-1" placeholder="得意先ID（例 C13）" value={sheet.customerId} onChange={(e) => setSheet({ ...sheet, customerId: e.target.value })} />
            <input className="rounded border px-2 py-1" placeholder="納品先（店舗名）" value={sheet.place} onChange={(e) => setSheet({ ...sheet, place: e.target.value })} />
          </div>
          <button className={btn} disabled={!!busy || !sheet.url} onClick={() => run("sheet", sheet.sheetName, sheet)}>このシートを読む</button>
        </section>

        <section className="card space-y-2 p-4">
          <h2 className="font-black">得意先の専用サイト（CSV）</h2>
          <p className="text-sm text-black/60">あおい医療フードサービスの発注サイトから落とした CSV を入れると、事業所ごとの注文と、振り分け表（仕入先への本発注・前日分・自社製造・包装・菓子パン）を作ります。仕入先に発注する分は、発注書の下書きになります。</p>
          <div className="flex flex-wrap gap-2">
            {samples.kirara.map((s) => (
              <button key={s} className={sub} disabled={!!busy} onClick={() => run("kirara", s, { sample: s })}>{s}</button>
            ))}
          </div>
          <label className="block text-sm">
            CSV を選ぶ <input type="file" accept=".csv" onChange={upload("kirara")} disabled={!!busy} />
          </label>
        </section>

        <section className="card space-y-2 p-4">
          <h2 className="font-black">インフォマート（受注 CSV）</h2>
          <p className="text-sm text-black/60">受注明細の CSV を取り込みます（いまは架空の形。実物の形は画面調査で合わせます）。</p>
          <div className="flex flex-wrap gap-2">
            {samples.infomart.map((s) => (
              <button key={s} className={sub} disabled={!!busy} onClick={() => run("infomart", s, { sample: s })}>{s}</button>
            ))}
          </div>
          <label className="block text-sm">
            CSV を選ぶ <input type="file" accept=".csv" onChange={upload("infomart")} disabled={!!busy} />
          </label>
        </section>
      </div>

      {busy && <div className="rounded-xl bg-blue-100 px-4 py-3 font-bold text-blue-900">取り込み中: {busy}（メールは Claude が読むので少し時間がかかります）</div>}
      {error && <div className="rounded-xl bg-red-100 px-4 py-3 font-bold text-red-800">{error}</div>}
      {result && <ResultView title={result.title} data={result.data} />}
    </div>
  );
}

function ResultView({ title, data }: { title: string; data: unknown }) {
  const d = data as Record<string, unknown>;
  return (
    <section className="card space-y-3 p-4">
      <h2 className="font-black">取り込み結果: {title}</h2>
      {"intent" in d && (
        <p>
          種類: <b>{({ new: "新しい注文", change: "変更", cancel: "キャンセル", not_order: "注文ではない" } as Record<string, string>)[d.intent as string]}</b>
          {d.changeOf ? <> ／ 元の注文: <code>{String(d.changeOf)}</code>（元の注文は書き換えていません）</> : null}
        </p>
      )}
      {Array.isArray(d.diffs) && (
        <div>
          <p className="font-bold">{d.firstTime ? "はじめて読みました（次から差分が出ます）" : `前回との差分 ${(d.diffs as unknown[]).length} か所`}</p>
          <ul className="text-sm">
            {(d.diffs as { date: string; column: string; before: number | null; after: number | null }[]).map((x, i) => (
              <li key={i}>
                {x.date} {x.column}: {x.before ?? "なし"} → <b>{x.after ?? "なし"}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
      {Array.isArray(d.routing) && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th>振り分け先</th><th>品目</th><th className="text-right">パック</th><th className="text-right">個数</th><th className="text-right">前回との差</th>
            </tr>
          </thead>
          <tbody>
            {(d.routing as { destLabel: string; shortName: string; packs: number; pieces: number; diff: number | null; productId: string }[]).map((r, i) => (
              <tr key={i} className={`border-t ${r.productId ? "" : "bg-amber-50"}`}>
                <td>{r.destLabel}</td><td>{r.shortName}</td><td className="text-right">{r.packs}</td><td className="text-right">{r.pieces}</td>
                <td className={`text-right ${r.diff ? "font-bold text-red-700" : ""}`}>{r.diff == null ? "—" : r.diff > 0 ? `+${r.diff}` : r.diff}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {Array.isArray(d.orderIds) && <p className="text-sm">受注一覧に「要確認」で入った注文: {(d.orderIds as string[]).length} 件</p>}
      {Array.isArray(d.purchaseOrders) && (d.purchaseOrders as unknown[]).length > 0 && (
        <div>
          <p className="font-bold">仕入先への発注書の下書き（承認は「発注の送り出し」で人が行います）</p>
          <ul className="text-sm">
            {(d.purchaseOrders as { id: string; supplierName: string; deliveryDate: string; deliveryName: string; lines: string[]; saved: boolean }[]).map((p) => (
              <li key={p.id}>
                ・{p.supplierName.replace(/・[^（）]*相当/, "")}（{p.deliveryName}・{p.deliveryDate} 着）：{p.lines.join("、")}
                {!p.saved && <span className="text-black/50">（承認済みのため上書きしていません）</span>}
              </li>
            ))}
          </ul>
          <a className="text-sm font-bold underline" href="/outbound">発注の送り出しへ</a>
        </div>
      )}
      <details>
        <summary className="cursor-pointer text-sm text-black/60">中身をすべて見る</summary>
        <pre className="max-h-96 overflow-auto rounded bg-gray-50 p-2 text-xs">{JSON.stringify(data, null, 2)}</pre>
      </details>
    </section>
  );
}
