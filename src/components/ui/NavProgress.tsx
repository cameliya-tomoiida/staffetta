"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

// 画面を移るリンクを押した瞬間に、上に細い帯を出す（11/8 担当者「押してから反応するまでが遅い。押した感じがしない」）。
// 先読みを止めたので（src/components/ui/Link.tsx）、次の画面が来るまで少し待つ。その間も「押した」ことが分かるように。
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [on, setOn] = useState(false);
  // 次の画面が来たら消す
  useEffect(() => setOn(false), [pathname, search]);
  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a");
      // data-instant: その場で切りかわるリンク（製造計画のタブなど）。帯は出さない
      if (!a || a.target === "_blank" || a.hasAttribute("download") || a.hasAttribute("data-instant")) return;
      const href = a.getAttribute("href") ?? "";
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      setOn(true);
    };
    // Next.js のリンクは押すと自分で移る（標準の動きを止める）ので、その前（capture）で見る
    document.addEventListener("click", click, true);
    return () => document.removeEventListener("click", click, true);
  }, []);
  useEffect(() => {
    if (!on) return;
    const t = setTimeout(() => setOn(false), 15000); // 来なかったときに出しっぱなしにしない
    return () => clearTimeout(t);
  }, [on]);
  if (!on) return null;
  return (
    <div role="progressbar" aria-label="読み込み中" className="no-print pointer-events-none fixed inset-x-0 top-0 z-[3000] h-1 overflow-hidden bg-crust-600/20">
      <div className="h-full w-1/3 animate-[navbar_1s_ease-in-out_infinite] bg-crust-600" />
      <style>{"@keyframes navbar{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}"}</style>
    </div>
  );
}
