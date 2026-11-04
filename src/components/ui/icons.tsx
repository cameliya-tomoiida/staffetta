// 線画のアイコン（外部ライブラリなし）。色は文字色（currentColor）に合わせる。
import type { OrderChannel, PurchaseMethod } from "@/data/types";
import { channelLabel, methodLabel } from "./tokens";

type P = { className?: string; title?: string };

function Svg({ className = "h-5 w-5", title, children }: P & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

const paths: Record<string, React.ReactNode> = {
  // FAX: 複合機と紙
  fax: (
    <>
      <path d="M7 9V3.5h8l2 2V9" />
      <rect x="3" y="9" width="18" height="9" rx="1.5" />
      <path d="M7 18v2.5h10V18" />
      <path d="M7 13h4M15.5 13h1.5" />
    </>
  ),
  // LINE: 吹き出し
  line: (
    <>
      <path d="M12 4C7 4 3 7.2 3 11.1c0 3.5 3.2 6.4 7.5 7l-.6 2.6 3.6-2.5C17.6 17.8 21 14.8 21 11.1 21 7.2 17 4 12 4Z" />
      <path d="M8 9.5v3h2M12.5 9.5v3M15 12.5v-3l2 3v-3" />
    </>
  ),
  // メール: 封筒
  email: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="1.5" />
      <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
    </>
  ),
  // シート: 表
  google_sheet: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M4 9h16M4 15h16M10 9v12" />
    </>
  ),
  // インフォマート: 画面と受発注の矢印
  infomart: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M9 20h6M12 16v4" />
      <path d="M7.5 8.5h7l-2-2M16.5 11.5h-7l2 2" />
    </>
  ),
  // 取引先サイト（きららなど）: ブラウザ
  customer_site: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M3 8.5h18" />
      <circle cx="6" cy="6.3" r=".4" fill="currentColor" />
      <circle cx="8" cy="6.3" r=".4" fill="currentColor" />
      <path d="M7 13h10M7 16.5h6" />
    </>
  ),
  // 電話: 受話器
  phone: (
    <path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16.5 16.5 0 0 1 4.5 5.5a2 2 0 0 1 2-2Z" />
  ),
  // ドライバー: トラック
  driver: (
    <>
      <path d="M2.5 6h11v10h-11zM13.5 9.5h4l3 3.5V16h-7" />
      <circle cx="6.5" cy="17.5" r="1.8" />
      <circle cx="17" cy="17.5" r="1.8" />
    </>
  ),
};

export function ChannelIcon({ channel, className }: { channel: OrderChannel; className?: string }) {
  return (
    <Svg className={className} title={channelLabel[channel].long}>
      {paths[channel]}
    </Svg>
  );
}

/** 入口のバッジ（アイコン＋名前）。色は使わず形と文字で見分ける */
export function ChannelBadge({ channel, size = "md" }: { channel: OrderChannel; size?: "sm" | "md" }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border border-rule-strong bg-sheet font-bold text-ink-soft whitespace-nowrap ${size === "sm" ? "px-1.5 py-0.5 text-xs" : "px-2 py-1 text-sm"}`}>
      <ChannelIcon channel={channel} className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
      {channelLabel[channel].short}
    </span>
  );
}

export function MethodIcon({ method, className }: { method: PurchaseMethod; className?: string }) {
  const kind = methodLabel[method].kind;
  const key = kind === "site" ? "customer_site" : kind;
  return (
    <Svg className={className} title={methodLabel[method].short}>
      {paths[key]}
    </Svg>
  );
}

/* そのほかの小さなアイコン */
export const Icon = {
  open: (p: P) => (
    <Svg {...p}>
      <path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </Svg>
  ),
  check: (p: P) => (
    <Svg {...p}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
  ),
  clock: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  ),
  send: (p: P) => (
    <Svg {...p}>
      <path d="M20.5 3.5 10 14M20.5 3.5 14 20.5l-4-6.5-6.5-4z" />
    </Svg>
  ),
  alert: (p: P) => (
    <Svg {...p}>
      <path d="M12 4 2.8 19.5h18.4z" />
      <path d="M12 10v4.5M12 17.2v.1" />
    </Svg>
  ),
  globe: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5Z" />
    </Svg>
  ),
  print: (p: P) => (
    <Svg {...p}>
      <path d="M7 9V3.5h10V9M7 17H4.5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h15a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H17" />
      <path d="M7 14h10v6.5H7z" />
    </Svg>
  ),
  bread: (p: P) => (
    <Svg {...p}>
      <path d="M5 11a3.5 3.5 0 0 1-1-6.5C6 3 9 3.5 12 3.5s6-.5 8 1A3.5 3.5 0 0 1 19 11v8.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" />
    </Svg>
  ),
  pizza: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="5.5" />
      <circle cx="10" cy="10.5" r=".9" fill="currentColor" />
      <circle cx="14" cy="11" r=".9" fill="currentColor" />
      <circle cx="11.5" cy="14.2" r=".9" fill="currentColor" />
    </Svg>
  ),
  sort: (p: P) => (
    <Svg {...p}>
      <path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5" />
    </Svg>
  ),
};
