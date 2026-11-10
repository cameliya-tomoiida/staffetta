"use client";
// お知らせを作る（値上げ・商品の変更・終売）。① 何を ② だれに ③ AI の下書きを直す ④ 下書きを保存 → 次の画面で OK して送る
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { choiceClass } from "@/components/ui";
import { useStaffNames } from "@/components/ui/staff";
import { NOTICE_KIND_LABEL, type NoticeDraft, type NoticeInput, type NoticeItem, type NoticeKind, type RecipientPick } from "@/lib/notices/plan";
import type { NoticeRecipient } from "@/lib/notices/store";
import { draftNoticeAction, previewRecipientsAction, saveNoticeAction } from "./actions";

const INPUT = "min-h-14 w-full rounded-lg border-2 border-rule-strong bg-sheet px-3 text-lg";
const LABEL = "block text-base font-bold text-ink-soft";
const CH: Record<string, string> = { line: "LINE", email: "メール", fax: "FAX", none: "手渡し" };

export function NoticeForm({ products, courses }: { products: { id: string; name: string; price: number }[]; courses: string[] }) {
  const router = useRouter();
  const staff = useStaffNames();
  const [who, setWho] = useState("");
  const [kind, setKind] = useState<NoticeKind>("price_up");
  const [effectiveDate, setDate] = useState("");
  const [items, setItems] = useState<NoticeItem[]>([{ name: "" }]);
  const [reason, setReason] = useState("");
  const [extra, setExtra] = useState("");
  const [mode, setMode] = useState<RecipientPick["mode"]>("product");
  const [pickCourses, setPickCourses] = useState<string[]>([]);
  const [list, setList] = useState<NoticeRecipient[] | null>(null);
  const [draft, setDraft] = useState<NoticeDraft | null>(null);
  const [by, setBy] = useState<"AI" | "決まりの文">("決まりの文");
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [pending, start] = useTransition();

  const input = (): NoticeInput => ({ kind, ...(effectiveDate ? { effectiveDate } : {}), items: items.filter((i) => i.name.trim()), ...(reason.trim() ? { reason: reason.trim() } : {}), ...(extra.trim() ? { extra: extra.trim() } : {}) });
  const pick = (): RecipientPick =>
    mode === "all" ? { mode } : mode === "course" ? { mode, courses: pickCourses } : { mode: "product", productIds: items.map((i) => i.productId).filter((x): x is string => !!x) };
  const setItem = (i: number, p: Partial<NoticeItem>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const num = (v: string) => (v.trim() === "" ? undefined : Number(v));

  const preview = () => start(async () => {
    const r = await previewRecipientsAction(pick());
    if (r.ok) setList(r.list);
    else setMsg({ ok: false, text: r.error });
  });
  const makeDraft = () => start(async () => {
    setMsg(undefined);
    const r = await draftNoticeAction(input());
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setDraft(r.draft);
    setBy(r.by);
  });
  const save = () => start(async () => {
    if (!draft) return;
    const r = await saveNoticeAction(input(), draft, by, pick(), who);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    router.push(`/notices/${r.id}`);
  });

  const count = (c: string) => list?.filter((x) => x.channel === c).length ?? 0;
  return (
    <div className="space-y-5">
      <section className="card space-y-4 p-4">
        <h2 className="text-2xl font-bold">① 何を知らせるか</h2>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          {(Object.keys(NOTICE_KIND_LABEL) as NoticeKind[]).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={k === kind} className={choiceClass(k === kind, "min-h-14 px-4 text-lg")}>{NOTICE_KIND_LABEL[k]}</button>
          ))}
        </div>
        <label className="block max-w-xs space-y-1"><span className={LABEL}>いつから（納品分）</span><input type="date" value={effectiveDate} onChange={(e) => setDate(e.target.value)} className={INPUT} /></label>
        <div className="space-y-3">
          <span className={LABEL}>商品</span>
          {items.map((it, i) => (
            <div key={i} className="grid gap-2 rounded-xl border-2 border-rule p-3 sm:grid-cols-[1fr_1fr_8rem_8rem]">
              <select aria-label="商品を選ぶ" value={it.productId ?? ""} onChange={(e) => {
                const p = products.find((x) => x.id === e.target.value);
                setItem(i, p ? { productId: p.id, name: p.name, oldPrice: p.price } : { productId: undefined });
              }} className={INPUT}>
                <option value="">（商品を選ぶ・手で書く）</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input aria-label="品名" value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} placeholder="品名" className={INPUT} />
              <input aria-label="今の価格" inputMode="decimal" value={it.oldPrice ?? ""} onChange={(e) => setItem(i, { oldPrice: num(e.target.value) })} placeholder="今の価格" className={INPUT} />
              <input aria-label="新しい価格" inputMode="decimal" value={it.newPrice ?? ""} onChange={(e) => setItem(i, { newPrice: num(e.target.value) })} placeholder="新しい価格" className={INPUT} />
              <input aria-label="変更の中身" value={it.note ?? ""} onChange={(e) => setItem(i, { note: e.target.value })} placeholder="変更の中身（規格・内容量など。なくてもよい）" className={`${INPUT} sm:col-span-4`} />
            </div>
          ))}
          <button type="button" onClick={() => setItems((xs) => [...xs, { name: "" }])} className="btn-ghost text-lg">＋ 商品を足す</button>
        </div>
        <label className="block space-y-1"><span className={LABEL}>わけ（例: 原材料の値上がり）</span><input value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT} /></label>
        <label className="block space-y-1"><span className={LABEL}>ほかに伝えること（なくてもよい）</span><textarea value={extra} onChange={(e) => setExtra(e.target.value)} rows={2} className={`${INPUT} py-2`} /></label>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-2xl font-bold">② だれに送るか</h2>
        <div className="grid grid-cols-3 gap-2 sm:flex">
          {([["product", "その商品を買っている所"], ["course", "コースごと"], ["all", "全部の取引先"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => { setMode(k); setList(null); }} aria-pressed={k === mode} className={choiceClass(k === mode, "min-h-14 px-3 text-lg")}>{l}</button>
          ))}
        </div>
        {mode === "course" && (
          <div className="flex flex-wrap gap-2">
            {courses.map((c) => (
              <label key={c} className="flex min-h-12 items-center gap-2 rounded-lg border-2 border-rule-strong px-3 text-lg">
                <input type="checkbox" checked={pickCourses.includes(c)} onChange={(e) => { setPickCourses((xs) => (e.target.checked ? [...xs, c] : xs.filter((x) => x !== c))); setList(null); }} className="h-6 w-6" />{c}
              </label>
            ))}
          </div>
        )}
        {mode === "product" && <p className="text-base text-ink-soft">①で選んだ商品を、取引先の商品か最近 90 日の注文で買っている取引先に送ります。</p>}
        <button type="button" onClick={preview} disabled={pending} className="btn-ghost text-lg">送る先を見る</button>
        {list && (
          <div className="space-y-2">
            <p className="text-lg font-bold">{list.length}件（LINE {count("line")}・メール {count("email")}・FAX {count("fax")}・手渡し {count("none")}）</p>
            <ul className="max-h-60 overflow-auto rounded-lg border border-rule">
              {list.map((r) => <li key={r.customerId} className="flex justify-between border-b border-rule px-3 py-2 text-lg last:border-b-0"><span>{r.name}</span><span className="text-ink-soft">{CH[r.channel]}</span></li>)}
            </ul>
          </div>
        )}
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-2xl font-bold">③ 文を作る</h2>
        <button type="button" onClick={makeDraft} disabled={pending || !items.some((i) => i.name.trim())} className="btn-primary text-lg">{pending ? "作っています…" : "AI に下書きしてもらう"}</button>
        {draft && (
          <div className="space-y-3">
            <span className="pill border-rule-strong text-base">{by === "AI" ? "AI が書いた下書き（直してください）" : "決まりの文（AI が使えないとき）"}</span>
            <label className="block space-y-1"><span className={LABEL}>題</span><input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={INPUT} /></label>
            <label className="block space-y-1"><span className={LABEL}>FAX・紙の文</span><textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={12} className={`${INPUT} py-2 leading-relaxed`} /></label>
            <label className="block space-y-1"><span className={LABEL}>LINE の文</span><textarea value={draft.line} onChange={(e) => setDraft({ ...draft, line: e.target.value })} rows={7} className={`${INPUT} py-2 leading-relaxed`} /></label>
          </div>
        )}
      </section>

      <section className="card flex flex-wrap items-end gap-3 p-4">
        <label className="space-y-1"><span className={LABEL}>作る人</span>
          <select value={who} onChange={(e) => setWho(e.target.value)} className={`${INPUT} w-48`}>
            <option value="">えらぶ</option>
            {staff.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <button type="button" onClick={save} disabled={pending || !draft || !who} className="btn-primary text-lg">④ 下書きを保存（まだ送りません）</button>
        {msg && <p role="status" className={`w-full text-lg font-bold ${msg.ok ? "text-ok-ink" : "text-alert-ink"}`}>{msg.text}</p>}
      </section>
    </div>
  );
}
