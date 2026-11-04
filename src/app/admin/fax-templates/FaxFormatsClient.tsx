"use client";
// FAX の様式の一覧と1件の編集（②の画面）。保存・無効化・履歴は①の server action。
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormatDraft, FormatRow } from "@/lib/fax-formats";
import type { FaxFormatKind } from "@/lib/types";
import type { HistoryRow } from "@/lib/db/masters";
import { disableFormatAction, enableFormatAction, formatHistoryAction, updateFormatAction } from "@/app/formats/actions";
import { AdminTable } from "@/components/admin/AdminTable";
import type { ColumnDef, Row } from "@/components/admin/types";
import { Button, buttonClass, fmtDateTime, Notice, SectionTitle, Tag } from "@/components/ui";
import { ConfirmInline } from "@/components/ui/ConfirmInline";
import { notifyHubChanged } from "@/components/ui/refresh";

const STAFF = ["事務 たなか", "課長 こばやし", "専務 はやし"];
const field = "min-h-12 w-full rounded-lg border-2 border-rule-strong bg-sheet px-3 text-ink focus:border-crust-600 focus:outline-none";
const actionLabel: Record<HistoryRow["action"], string> = { insert: "登録", update: "変更", disable: "無効にした", restore: "戻した" };

export function FaxFormatsClient({
  formats, drafts, kinds, products,
}: {
  formats: FormatRow[];
  drafts: FormatDraft[];
  kinds: Record<FaxFormatKind, string>;
  products: { id: string; name: string }[];
}) {
  const [who, setWho] = useState(STAFF[0]);
  const [pickId, setPickId] = useState<string | null>(null);
  const picked = formats.find((f) => f.id === pickId) ?? null;

  const columns: ColumnDef[] = [
    { key: "customerName", label: "取引先" },
    { key: "kind", label: "様式の型" },
    { key: "itemCount", label: "品名の数", type: "number" },
    { key: "faxCount", label: "受信枚数", type: "number" },
    { key: "lastFaxAt", label: "最後に届いた日" },
    { key: "state", label: "状態" },
  ];
  const rows: Row[] = formats.map((f) => ({
    id: f.id,
    customerName: f.customerName,
    kind: f.formatKind ? kinds[f.formatKind] : "—",
    itemCount: f.itemCount,
    faxCount: f.faxCount,
    lastFaxAt: f.lastFaxAt ? fmtDateTime(f.lastFaxAt) : "",
    state: f.disabled ? "無効" : "使っている",
  }));

  return (
    <div className="space-y-6">
      <label className="flex items-center gap-2 text-sm font-bold text-ink-soft">
        変える人
        <select value={who} onChange={(e) => setWho(e.target.value)} className="min-h-12 rounded-lg border-2 border-rule-strong bg-sheet px-3 font-bold text-ink">
          {STAFF.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>

      {/* 承認待ち */}
      <section>
        <SectionTitle aside={`${drafts.length} 件`}>承認待ち（初めての様式）</SectionTitle>
        {drafts.length === 0 ? (
          <p className="text-ink-soft">承認待ちの様式はありません。</p>
        ) : (
          <ul className="space-y-2">
            {drafts.map((d) => (
              <li key={d.faxId} className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-review-line bg-review-bg/50 px-4 py-3">
                <Tag tone="review">承認待ち</Tag>
                <div className="min-w-0 flex-1">
                  <div className="font-black">
                    {d.customerName ?? "（取引先が分かりません）"}　{d.title}
                  </div>
                  <div className="text-sm text-ink-soft">
                    {fmtDateTime(d.receivedAt)} 受信・品名 {d.items.length} 行{d.formatKind ? `・${kinds[d.formatKind]}` : ""}
                  </div>
                </div>
                <Link href={`/fax/${d.faxId}`} className={buttonClass("primary")}>
                  FAXと見比べて承認する
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 1件の編集 */}
      {picked && <FormatEditor key={picked.id} f={picked} who={who} kinds={kinds} products={products} onClose={() => setPickId(null)} />}

      {/* 一覧 */}
      <section>
        <SectionTitle aside="行の「編集」で中身を直す">登録済みの様式</SectionTitle>
        <AdminTable columns={columns} rows={rows} idKey="id" selectedId={pickId} onPick={(r) => setPickId(String(r.id))} />
      </section>
    </div>
  );
}

function FormatEditor({
  f, who, kinds, products, onClose,
}: {
  f: FormatRow;
  who: string;
  kinds: Record<FaxFormatKind, string>;
  products: { id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<FaxFormatKind | "">(f.formatKind ?? "");
  const [pageNote, setPageNote] = useState(f.pageNote ?? "");
  const [note, setNote] = useState(f.note ?? "");
  const [items, setItems] = useState<[string, string][]>(Object.entries(f.items));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    start(async () => {
      try {
        await fn();
        setMsg({ ok: true, text: ok });
        router.refresh();
        notifyHubChanged();
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
      }
    });
  };

  return (
    <section className="rounded-lg border-2 border-crust-600 bg-sheet">
      <div className="flex flex-wrap items-center gap-2 border-b border-rule bg-cream px-4 py-2">
        <h2 className="text-lg font-black">{f.customerName} の様式</h2>
        {f.disabled ? <Tag tone="off">無効</Tag> : <Tag tone="ok">使っている</Tag>}
        <span className="text-sm text-ink-soft">
          承認：{f.approvedBy}（{fmtDateTime(f.approvedAt)}）
        </span>
      </div>

      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block font-bold">様式の型</label>
          <select className={field} value={kind} onChange={(e) => setKind(e.target.value as FaxFormatKind)}>
            <option value="">えらんでください</option>
            {(Object.keys(kinds) as FaxFormatKind[]).map((k) => (
              <option key={k} value={k}>
                {kinds[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block font-bold">何枚つづりか・ページの関係</label>
          <input className={field} value={pageNote} onChange={(e) => setPageNote(e.target.value)} placeholder="例: 13枚つづりで1枚1日分" />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block font-bold">メモ（読み取りのときに Claude にも伝えます）</label>
          <textarea className={`${field} min-h-20 py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>

      <div className="border-t border-rule p-4">
        <h3 className="mb-2 font-black">書いてある品名 → 商品（{items.length} 行）</h3>
        <table className="w-full">
          <thead>
            <tr className="border-b-2 border-rule-strong bg-cream text-left text-sm">
              <th className="px-3 py-2">FAX に書いてある品名</th>
              <th className="px-3 py-2">うちの商品</th>
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {items.map(([w, pid], i) => (
              <tr key={w} className="border-b border-rule">
                <td className="px-3 py-2 font-bold">{w}</td>
                <td className="px-3 py-1">
                  <select
                    className={field}
                    value={pid}
                    onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? [x[0], e.target.value] : x)))}
                  >
                    {!products.some((p) => p.id === pid) && <option value={pid}>{pid || "えらんでください"}</option>}
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-1 text-right">
                  <Button variant="quiet" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}>
                    外す
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 border-t border-rule p-4">
        {msg && <Notice tone={msg.ok ? "ok" : "alert"}>{msg.text}</Notice>}
        <div className="flex flex-wrap items-start gap-2">
          <Button
            variant="primary"
            size="lg"
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  updateFormatAction(
                    f.id,
                    { items: Object.fromEntries(items), formatKind: kind || undefined, pageNote, note },
                    who,
                  ),
                "保存しました",
              )
            }
          >
            {pending ? "保存しています…" : "保存する"}
          </Button>
          {f.disabled ? (
            <Button disabled={pending} onClick={() => run(() => enableFormatAction(f.id, who), "使う状態に戻しました")}>
              使う状態に戻す
            </Button>
          ) : (
            <ConfirmInline
              label="この様式を無効にする"
              message="無効にすると、この取引先の次の FAX は「承認待ち」になります。よろしいですか？"
              yesLabel="無効にする"
              noLabel="やめる"
              onConfirm={() => disableFormatAction(f.id, who).then(() => router.refresh())}
            />
          )}
          <Button
            variant="quiet"
            onClick={() => start(async () => setHistory(await formatHistoryAction(f.id)))}
          >
            変更の記録を見る
          </Button>
          <Button variant="quiet" onClick={onClose}>
            とじる
          </Button>
        </div>
        {history && (
          <div className="mt-2 rounded-lg border border-rule">
            {history.length === 0 ? (
              <p className="px-3 py-2 text-ink-soft">記録はまだありません。</p>
            ) : (
              <ul className="divide-y divide-rule">
                {history.map((h) => (
                  <li key={h.seq} className="flex flex-wrap gap-x-4 px-3 py-2 text-sm">
                    <span className="num">{fmtDateTime(h.at)}</span>
                    <span className="font-bold">{actionLabel[h.action]}</span>
                    <span>{h.who}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
