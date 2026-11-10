"use client";
// 生地カード（②）。1枚＝1生地。カードに配合を小さく出し、タップすると内訳を大きく開く。
// 使う所: レシピの画面（/masters/recipes）・配合の画面（/masters/recipeItems）・製造計画の「作るもの」の生地名。
// データは cards.ts の doughCards()（サーバーで作って渡す）。
import { useEffect, useRef, useState } from "react";
import { buttonClass, fmtDate, Icon, LinkButton, Notice, Tag } from "@/components/ui";
import type { DoughCard } from "./cards";

const g = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
const kg = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const pct = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
const lossPct = (r: number) => pct(Math.round(r * 1000) / 10);

/** 生地カードを並べる（タブレットで横に3〜4枚） */
export function DoughCards({ cards, editable = true, openId }: { cards: DoughCard[]; editable?: boolean; openId?: string }) {
  const [open, setOpen] = useState<string | undefined>(openId);
  const card = cards.find((c) => c.id === open);
  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {cards.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => setOpen(c.id)}
              className="flex h-full w-full flex-col rounded-lg border-2 border-rule-strong bg-sheet text-left transition-colors hover:border-crust-600 focus-visible:border-crust-600"
              aria-label={`${c.name} の内訳を開く`}
            >
              <div className="border-b border-rule-strong bg-cream px-3 py-2">
                <div className="text-lg leading-tight font-black">{c.name}</div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-soft">
                  {c.line === "pizza" ? <Icon.pizza className="h-4 w-4" /> : <Icon.bread className="h-4 w-4" />}
                  <span className="font-bold">{c.lineName}</span>
                  <span className="num text-ink-faint">{c.id}</span>
                </div>
              </div>
              <dl className="grid grid-cols-3 border-b border-rule text-center">
                <Mini label="粉の合計" value={`${pct(c.flourPercent)}%`} warn={Math.abs(c.flourPercent - 100) > 0.01} />
                <Mini label="生地のロス" value={`${lossPct(c.lossRate)}%`} />
                <Mini label="使う商品" value={`${c.products.length}品`} />
              </dl>
              <RecipeTable card={c} small />
              <div className="mt-auto flex items-center justify-end gap-1 border-t border-rule px-3 py-2 text-sm font-bold text-crust-700">
                内訳を見る <span aria-hidden>›</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
      {card && <DoughDialog card={card} editable={editable} onClose={() => setOpen(undefined)} />}
    </>
  );
}

/** 1つの生地の内訳を開くボタン（製造計画の「作るもの」の生地名など） */
export function DoughDetailButton({ card, children, className = "" }: { card: DoughCard; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`text-left underline decoration-crust-200 decoration-2 underline-offset-4 hover:decoration-crust-600 print:no-underline ${className}`}>
        {children}
      </button>
      {open && <DoughDialog card={card} editable onClose={() => setOpen(false)} />}
    </>
  );
}

function Mini({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="border-r border-rule px-1 py-1.5 last:border-r-0">
      <dt className="text-[0.7rem] text-ink-soft">{label}</dt>
      <dd className={`num font-black ${warn ? "text-alert-ink" : ""}`}>{value}</dd>
    </div>
  );
}

/** 配合の表（材料｜ベーカーズ％｜1回分の g［｜その日のぶん kg］）。粉は太字、数は右にそろえる */
function RecipeTable({ card, small, withPlan }: { card: DoughCard; small?: boolean; withPlan?: boolean }) {
  const plan = withPlan ? card.plan : undefined;
  if (!card.items.length) return <p className="px-3 py-3 text-sm text-ink-soft">配合がまだありません</p>;
  const cell = small ? "px-2 py-1 first:pl-3 last:pr-3" : "px-3 py-2";
  return (
    <table className={`w-full ${small ? "text-sm" : "text-base"}`}>
      <thead>
        <tr className="border-b border-rule-strong text-left text-xs text-ink-soft [&>th]:font-bold [&>th]:whitespace-nowrap">
          <th className={cell}>材料</th>
          <th className={`${cell} text-right`}>％</th>
          <th className={`${cell} text-right`}>{small ? `1回 ${pct(card.batchKg)}kg` : `ミキサー1回分（生地 ${pct(card.batchKg)}kg）`}</th>
          {plan && <th className={`${cell} text-right`}>{fmtDate(plan.date)} のぶん（生地 {pct(plan.doughKg)}kg）</th>}
        </tr>
      </thead>
      <tbody>
        {card.items.map((i) => (
          <tr key={i.materialId} className={`border-b border-dashed border-rule last:border-b-0 ${i.flour ? "font-black" : ""}`}>
            <td className={`${cell}`}>{i.name}</td>
            <td className={`${cell} num text-right whitespace-nowrap`}>{pct(i.percent)}</td>
            <td className={`${cell} num text-right whitespace-nowrap`}>{g(i.batchG)}<span className="ml-0.5 text-xs font-normal text-ink-soft">g</span></td>
            {plan && <td className={`${cell} num text-right whitespace-nowrap`}>{i.planKg !== undefined ? kg(i.planKg) : "-"}<span className="ml-0.5 text-xs font-normal text-ink-soft">kg</span></td>}
          </tr>
        ))}
      </tbody>
      {!small && (
        <tfoot>
          <tr className="border-t-2 border-rule-strong font-black">
            <td className={cell}>合計</td>
            <td className={`${cell} num text-right`}>{pct(card.totalPercent)}</td>
            <td className={`${cell} num text-right`}>{g(card.items.reduce((s, i) => s + i.batchG, 0))}<span className="ml-0.5 text-xs font-normal text-ink-soft">g</span></td>
            {plan && <td className={`${cell} num text-right`}>{kg(card.items.reduce((s, i) => s + (i.planKg ?? 0), 0))}<span className="ml-0.5 text-xs font-normal text-ink-soft">kg</span></td>}
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/** 内訳（その場で大きく開く） */
function DoughDialog({ card, editable, onClose }: { card: DoughCard; editable: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const p = card.plan;
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(60rem,calc(100vw-1.5rem))] rounded-lg border-2 border-rule-strong bg-paper p-0 text-ink backdrop:bg-ink/45"
      aria-label={`${card.name} の内訳`}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b-2 border-crust-600 bg-sheet px-4 py-3">
        <div className="min-w-0">
          <div className="text-xs text-ink-soft">生地のレシピ <span className="num">{card.id}</span>・{card.lineName}</div>
          <h2 className="text-2xl leading-tight font-black">{card.name}</h2>
        </div>
        <button type="button" className={buttonClass("ghost", "md", "shrink-0")} onClick={() => ref.current?.close()}>閉じる</button>
      </div>

      <div className="space-y-5 p-4">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Big label="粉の合計（100 が基準）" value={pct(card.flourPercent)} unit="%" warn={Math.abs(card.flourPercent - 100) > 0.01} />
          <Big label="％の合計" value={pct(card.totalPercent)} unit="%" />
          <Big label="生地のロス" value={lossPct(card.lossRate)} unit="%" />
          <Big label="ミキサー1回の上限" value={pct(card.mixerMaxKg)} unit="kg" />
        </dl>
        {card.warnings.map((w) => <Notice key={w} tone="alert">{w}</Notice>)}

        {p && (
          <p className="rounded-lg border border-rule-strong bg-sheet px-4 py-3">
            <span className="font-bold">{fmtDate(p.date)} の製造</span>：
            <span className="num font-black">{p.pieces.toLocaleString("ja-JP")}</span>個・生地 <span className="num font-black">{pct(p.doughKg)}</span>kg（粉 <span className="num">{pct(p.flourKg)}</span>kg）を、
            ミキサー <span className="num font-black">{p.batches}</span>回（1回 <span className="num font-black">{pct(p.batchKg)}</span>kg）
          </p>
        )}

        <section className="overflow-x-auto rounded-lg border border-rule-strong bg-sheet">
          <h3 className="border-b border-rule-strong bg-cream px-3 py-2 font-black">配合（ベーカーズ％）</h3>
          <RecipeTable card={card} withPlan />
          <p className="border-t border-rule px-3 py-2 text-xs text-ink-soft">太字は粉（％の基準）。g は「粉 kg = 生地 kg ÷ (％の合計 ÷ 100)」で出しています。</p>
        </section>

        <section className="overflow-x-auto rounded-lg border border-rule-strong bg-sheet">
          <h3 className="border-b border-rule-strong bg-cream px-3 py-2 font-black">工程</h3>
          {card.steps.length ? (
            <table className="w-full text-base">
              <thead>
                <tr className="border-b border-rule-strong text-left text-xs text-ink-soft [&>th]:px-3 [&>th]:py-1.5 [&>th]:whitespace-nowrap">
                  <th className="w-10 text-right">順</th><th>工程</th><th className="text-right">時間</th><th className="text-right">人</th><th>設備</th><th />
                </tr>
              </thead>
              <tbody>
                {card.steps.map((s) => (
                  <tr key={s.seq} className="border-b border-dashed border-rule last:border-b-0 [&>td]:px-3 [&>td]:py-1.5">
                    <td className="num text-right text-ink-soft">{s.seq}</td>
                    <td className="font-bold">{s.name}{s.note && <span className="block text-xs font-normal text-ink-soft">{s.note}</span>}</td>
                    <td className="num text-right whitespace-nowrap">
                      {s.minutes ? `${s.minutes}分` : ""}
                      {s.perBatch ? <span className="block text-xs text-ink-soft">1回ごと {s.perBatch}分</span> : !s.minutes ? "-" : ""}
                    </td>
                    <td className="num text-right">{s.people}</td>
                    <td className="text-sm">{s.equipment ?? <span className="text-ink-faint">-</span>}</td>
                    <td className="space-x-1 text-right whitespace-nowrap">
                      {s.prevDay && <Tag>前日</Tag>}
                      {s.ccp && <Tag tone="alert">CCP</Tag>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-3 py-3 text-ink-soft">工程がまだありません</p>
          )}
        </section>

        <section className="rounded-lg border border-rule-strong bg-sheet">
          <h3 className="border-b border-rule-strong bg-cream px-3 py-2 font-black">この生地を使う商品（{card.products.length}品）</h3>
          {card.products.length ? (
            <ul className="flex flex-wrap gap-2 p-3">
              {card.products.map((p) => (
                <li key={p.id} className="rounded-md border border-rule-strong px-2.5 py-1">
                  {p.name}{p.doughGram ? <span className="num ml-1 text-sm text-ink-soft">{p.doughGram}g</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-3 text-ink-soft">まだありません</p>
          )}
        </section>
      </div>

      {editable && (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t-2 border-crust-600 bg-sheet px-4 py-3">
          <LinkButton href={`/masters/recipes?dough=${card.id}#edit`} variant="primary" size="lg">この配合を直す</LinkButton>
          <LinkButton href="/masters/steps" variant="ghost">工程を直す</LinkButton>
          <button type="button" className={buttonClass("quiet", "md", "ml-auto")} onClick={() => ref.current?.close()}>閉じる</button>
        </div>
      )}
    </dialog>
  );
}

function Big({ label, value, unit, warn }: { label: string; value: string; unit: string; warn?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${warn ? "border-alert-line bg-alert-bg" : "border-rule-strong bg-sheet"}`}>
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="num text-2xl font-black">{value}<span className="ml-0.5 text-sm font-bold">{unit}</span></dd>
    </div>
  );
}
