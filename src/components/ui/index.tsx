// 共通の部品（②デザイン）。画面はなるべくここの部品だけで組む。
import Link from "next/link";
import { todayJst as clockTodayJst } from "@/lib/clock";
import type { OrderStatus } from "@/data/types";
import { orderStatus, purchaseStatus, toneClass, type PurchaseStatus, type Tone } from "./tokens";

export * from "./tokens";
export * from "./icons";

/* ───── ボタン ───── */
type BtnVariant = "primary" | "ghost" | "ok" | "quiet";
type BtnSize = "md" | "lg";
const variantClass: Record<BtnVariant, string> = {
  // 主ボタン: 赤地に白文字（1画面に1つが原則）
  primary: "border-crust-600 bg-crust-600 text-white hover:border-crust-700 hover:bg-crust-700",
  // 二番目のボタン: 白地に赤の線と赤い文字
  ghost: "border-crust-600 bg-sheet text-crust-700 hover:bg-crust-50",
  // 「承認する」「確定する」も主ボタンと同じ赤（緑は状態の色にだけ使う）
  ok: "border-crust-600 bg-crust-600 text-white hover:border-crust-700 hover:bg-crust-700",
  // 目立たせない操作（やめる・戻す）: 下線つきの文字
  quiet: "border-transparent text-crust-700 underline underline-offset-4 hover:bg-crust-50",
};
const sizeClass: Record<BtnSize, string> = {
  md: "min-h-12 px-5 text-base",
  lg: "min-h-14 px-6 text-lg",
};
/** 押せないボタンは灰色（うすくするだけだと、押せるのか分からない） */
const disabledClass = "disabled:pointer-events-none disabled:border-off-line disabled:bg-off-bg disabled:text-off-ink disabled:no-underline";
export const buttonClass = (variant: BtnVariant = "ghost", size: BtnSize = "md", extra = "") =>
  `inline-flex items-center justify-center gap-2 rounded-lg border-2 font-bold transition-colors select-none active:translate-y-px ${disabledClass} ${variantClass[variant]} ${sizeClass[size]} ${extra}`;

/** 選ぶボタン（日付・状態・ことば・お店など）。選んだものは赤い線・うすい赤の地・赤い文字 */
export const choiceClass = (on: boolean, extra = "") =>
  `rounded-lg border-2 font-bold transition-colors select-none ${
    on ? "border-crust-600 bg-crust-50 text-crust-700" : "border-rule-strong bg-sheet text-ink hover:border-crust-200 hover:bg-crust-50"
  } ${extra}`;

export function Button({ variant, size, className = "", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize }) {
  return <button type="button" className={buttonClass(variant, size, className)} {...rest} />;
}

export function LinkButton({ variant, size, className = "", ...rest }: React.ComponentProps<typeof Link> & { variant?: BtnVariant; size?: BtnSize }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

/* ───── 状態の札 ───── */
export function Tag({ tone = "plain", children, className = "" }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-sm font-bold whitespace-nowrap ${toneClass[tone]} ${className}`}>{children}</span>;
}

export function OrderStatusTag({ status }: { status: OrderStatus }) {
  const s = orderStatus[status];
  return <Tag tone={s.tone}>{s.label}</Tag>;
}

export function PurchaseStatusTag({ status }: { status: PurchaseStatus }) {
  const s = purchaseStatus[status];
  return <Tag tone={s.tone}>{s.label}</Tag>;
}

/* ───── 画面の見出し ───── */
export function PageHeader({ title, lead, children }: { title: React.ReactNode; lead?: React.ReactNode; children?: React.ReactNode }) {
  return (
    // ⑧ スマホ（11/7）: 題と説明は出さない（上の帯に画面の名前が出ている・説明の文は読まれない）。ボタンなど children だけ
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b-2 border-crust-600 pb-3 max-md:mb-3 max-md:border-b-0 max-md:pb-0">
      <div className="min-w-0 max-md:hidden">
        <h1 className="text-[1.65rem] leading-tight font-black tracking-wide" title={typeof lead === "string" ? lead : undefined}>{title}</h1>
        {/* ⑧ 11/7 担当者「説明の文は入れない」: パソコンでも説明の文（lead）は出さない。題に合わせた補足は「？」で（title に入れる） */}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** 帳票の小見出し（左に太線） */
export function SectionTitle({ children, aside, color }: { children: React.ReactNode; aside?: React.ReactNode; color?: string }) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="border-l-[6px] pl-2.5 text-xl font-black" style={{ borderColor: color ?? "var(--color-ink)" }}>
        {children}
      </h2>
      {aside && <div className="text-sm text-ink-soft">{aside}</div>}
    </div>
  );
}

/** 帯のお知らせ（要確認がある・締めが近い など） */
export function Notice({ tone = "review", icon, children, className = "" }: { tone?: Tone; icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex items-start gap-2.5 rounded-lg border-l-[6px] border px-4 py-3 font-bold ${toneClass[tone]} ${className}`}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** 選ぶボタンの列（絞り込み・言語・ラインなど）。1つだけ選べる */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  label,
}: {
  value: T;
  options: { value: T; label: React.ReactNode; count?: number }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={choiceClass(on, `inline-flex items-center gap-1.5 ${size === "sm" ? "min-h-10 px-3 text-sm" : "min-h-12 px-4"}`)}
          >
            {o.label}
            {o.count != null && <span className={`num rounded px-1.5 text-sm ${on ? "bg-crust-100" : "bg-cream"}`}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** 何もないとき */
export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-rule-strong px-4 py-10 text-center text-ink-soft">{children}</div>;
}

/** 大きな数字（個数・kg） */
export function Figure({ value, unit, label, small }: { value: React.ReactNode; unit?: string; label?: React.ReactNode; small?: boolean }) {
  return (
    <div>
      {label && <div className="text-sm text-ink-soft">{label}</div>}
      <div className={`num leading-none font-black ${small ? "text-2xl" : "text-[2.1rem]"}`}>
        {value}
        {unit && <span className="ml-1 text-base font-bold text-ink-soft">{unit}</span>}
      </div>
    </div>
  );
}

/** 「機械翻訳」の印 */
export function MachineTranslated({ label = "機械翻訳" }: { label?: string }) {
  return (
    <span className="inline-flex items-center rounded border border-info-line bg-info-bg px-1 align-middle text-[0.7rem] leading-4 font-bold text-info-ink" title="機械翻訳（人が確認していない訳）">
      {label}
    </span>
  );
}

/* ───── 日付・時刻の表示 ───── */
const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
/** 2026-11-05 → 11/5(木) */
export function fmtDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y) return iso;
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}/${d}(${WEEK[w]})`;
}
/** ISO日時 → 11/5 8:12 */
export function fmtDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
}
/** 日本時間の今日（YYYY-MM-DD）。③の共通の時計（DEMO_NOW があればデモの時刻） */
export const todayJst = () => clockTodayJst();
export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
export const fmtNum =(n: number, digits = 0) => n.toLocaleString("ja-JP", { maximumFractionDigits: digits, minimumFractionDigits: digits });

/**
 * 数と単位。単位が数字で始まるとき（25kg袋・30枚切）は「1 × 25kg袋」と出す
 * （「125kg袋」「330枚切」と読み間違えないように）。
 */
export function Qty({ units, unit, size = "text-2xl" }: { units: number; unit: string; size?: string }) {
  const times = /^[0-9０-９]/.test(unit);
  return (
    <span className="whitespace-nowrap">
      <span className={`num font-black ${size}`}>{fmtNum(units)}</span>
      <span className="ml-1 text-sm">
        {times && <span className="mr-1 font-bold">×</span>}
        {unit}
      </span>
    </span>
  );
}
