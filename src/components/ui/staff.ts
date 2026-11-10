"use client";
// 画面の「確認した人」「操作する人」の選択肢（スタッフの登録 /settings/staff から。ログインしている人が先頭）。
// 1回だけ /api/staff を取りに行き、ほかの画面でも使い回す。取れるまでは見本の名前。
import { useSyncExternalStore } from "react";

const FALLBACK = ["たなか", "うえの", "はやし"];
let names: string[] = FALLBACK;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load() {
  loading ??= fetch("/api/staff", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { names?: string[] } | null) => {
      if (d?.names?.length) {
        names = d.names;
        listeners.forEach((l) => l());
      }
    })
    .catch(() => {
      loading = null; // 取れなければ、次に使うときにもう一度
    });
}

function subscribe(l: () => void) {
  listeners.add(l);
  load();
  return () => listeners.delete(l);
}

/** スタッフの名前（有効な人だけ。ログインしている人が先頭） */
export function useStaffNames(): string[] {
  return useSyncExternalStore(subscribe, () => names, () => FALLBACK);
}
