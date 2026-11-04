// 共通の部品（②デザイン）。画面はなるべくここの部品だけで組む。
import Link from "next/link";
import type { OrderStatus } from "@/data/types";
import { orderStatus, purchaseStatus, toneClass, type PurchaseStatus, type Tone } from "./tokens";

export * from "./tokens";
export * from "./icons";

/* ───── ボタン ───── */
type BtnVariant = "primary" | "ghost" | "ok" | "quiet";
type BtnSize = "md" | "lg";
const variantClass: Record<BtnVariant, string> = {
  primary: "bg-crust-600 text-white hover:bg-crust-700",
  ghost: "border border-rule-strong bg-sheet text-ink hover:bg-crust-50",
  ok: "bg-ok-ink text-white hover:bg-[#1c4621]",
  quiet: "text-ink-soft hover:bg-black/5",
};
const sizeClass: Record<BtnSize, string> = {
  md: "min-h-12 px-5 text-base",
  lg: "min-h-14 px-6 text-lg",
};
export const buttonClass = (variant: BtnVariant = "ghost", size: BtnSize = "md", extra = "") =>
  `inline-flex items-center justify-center gap-2 rounded-lg font-bold transition-colors select-none active:translate-y-px disabled:pointer-events-none disabled:opacity-45 ${variantClass[variant]} ${sizeClass[size]} ${extra}`;

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
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b-2 border-ink pb-3">
      <div className="min-w-0">
        <h1 className="text-[1.65rem] leading-tight font-black tracking-wide">{title}</h1>
        {lead && <p className="mt-1 text-ink-soft">{lead}</p>}
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
            className={`inline-flex items-center gap-1.5 rounded-lg border font-bold transition-colors select-none ${size === "sm" ? "min-h-10 px-3 text-sm" : "min-h-12 px-4"} ${
              on ? "border-ink bg-ink text-white" : "border-rule-strong bg-sheet text-ink hover:bg-crust-50"
            }`}
          >
            {o.label}
            {o.count != null && <span className={`num rounded px-1.5 text-sm ${on ? "bg-white/20" : "bg-black/5"}`}>{o.count}</span>}
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
/** 日本時間の今日（YYYY-MM-DD） */
export const todayJst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
export const fmtNum =(n: number, digits = 0) => n.toLocaleString("ja-JP", { maximumFractionDigits: digits, minimumFractionDigits: digits });
