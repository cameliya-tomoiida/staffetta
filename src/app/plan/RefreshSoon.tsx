"use client";
// 訳を裏で作っている間、少し待ってから画面を取り直す（訳ができたら日本語から差し替わる）。
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function RefreshSoon({ label, ms = 6000 }: { label: string; ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => router.refresh(), ms);
    return () => clearTimeout(t);
  }, [router, ms]);
  return (
    <p className="no-print mb-3 text-sm text-ink-soft" lang="ja" role="status">
      {label}
    </p>
  );
}
