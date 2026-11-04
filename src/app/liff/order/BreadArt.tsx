// 商品の絵（写真の代わりの線画。外部の画像は使わない）。色は currentColor。

type Kind = "roll" | "darkroll" | "loaf" | "bun" | "sandwich" | "pizza" | "pack";

export function breadKind(name: string): Kind {
  if (name.includes("ピザ")) return "pizza";
  if (name.includes("サンド")) return "sandwich";
  if (name.includes("バンズ")) return "bun";
  if (name.includes("食パン")) return "loaf";
  if (name.includes("入")) return "pack";
  if (name.includes("黒糖")) return "darkroll";
  return "roll";
}

export function BreadArt({ name, className = "h-12 w-12" }: { name: string; className?: string }) {
  const k = breadKind(name);
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {k === "roll" && (
        <>
          <path d="M10 40c0-11 10-20 22-20s22 9 22 20c0 3-2 5-5 5H15c-3 0-5-2-5-5Z" />
          <path d="M24 24c2 6 2 14 0 21M33 21c2 8 2 16 0 24M42 24c2 6 2 14 0 21" />
        </>
      )}
      {k === "darkroll" && (
        <>
          <path d="M10 40c0-11 10-20 22-20s22 9 22 20c0 3-2 5-5 5H15c-3 0-5-2-5-5Z" fill="currentColor" fillOpacity={0.18} />
          <path d="M24 24c2 6 2 14 0 21M33 21c2 8 2 16 0 24M42 24c2 6 2 14 0 21" />
        </>
      )}
      {k === "loaf" && (
        <>
          <path d="M14 50V30c-4 0-6-3-6-7 0-6 6-10 13-10h22c7 0 13 4 13 10 0 4-2 7-6 7v20c0 2-1 3-3 3H17c-2 0-3-1-3-3Z" />
          <path d="M22 30v16M32 30v16M42 30v16" strokeOpacity={0.55} />
        </>
      )}
      {k === "bun" && (
        <>
          <path d="M9 36c0-10 10-17 23-17s23 7 23 17Z" />
          <path d="M9 42h46" />
          <path d="M12 48h40c0 2-2 4-4 4H16c-2 0-4-2-4-4Z" />
          <path d="M22 28l1 1M30 25l1 1M38 28l1 1M44 32l1 1M27 31l1 1" strokeWidth={3} />
        </>
      )}
      {k === "sandwich" && (
        <>
          <path d="M10 36c0-9 10-16 22-16s22 7 22 16" />
          <path d="M8 40c4-3 8 3 12 0s8 3 12 0 8 3 12 0 8 3 12 0" />
          <path d="M11 44h42c0 3-2 6-6 6H17c-4 0-6-3-6-6Z" />
        </>
      )}
      {k === "pizza" && (
        <>
          <circle cx="32" cy="32" r="22" />
          <circle cx="32" cy="32" r="16" strokeOpacity={0.55} />
          <path d="M26 26h.1M38 28h.1M30 38h.1M40 38h.1" strokeWidth={4} />
        </>
      )}
      {k === "pack" && (
        <>
          <rect x="10" y="20" width="44" height="30" rx="6" />
          <path d="M18 34c0-4 3-7 7-7s7 3 7 7M32 34c0-4 3-7 7-7s7 3 7 7" />
          <path d="M10 40h44" strokeOpacity={0.55} />
          <path d="M26 14l6 6 6-6" />
        </>
      )}
    </svg>
  );
}
