"use client";
// 商品の名前を、サーバーの画面（DB のマスタ）からクライアントの部品へ渡す（管理役2 11/7）。
// クライアントで findProduct を引くと見本のマスタしか見ないので、DB だけにある商品が「商品が決まっていません」になっていた。
import { createContext, useContext } from "react";
import { findProduct } from "@/lib/catalog";

export interface ProductLite {
  name: string;
  unit?: string;
}

const Ctx = createContext<Record<string, ProductLite>>({});

export function ProductNamesProvider({ names, children }: { names: Record<string, ProductLite>; children: React.ReactNode }) {
  return <Ctx.Provider value={names}>{children}</Ctx.Provider>;
}

/** 商品 id → 名前・単位（DB のマスタ → 無ければ見本のマスタ） */
export function useProductLookup() {
  const names = useContext(Ctx);
  return (id: string | undefined): ProductLite | undefined => {
    if (!id) return undefined;
    if (names[id]) return names[id];
    const p = findProduct(id);
    return p ? { name: p.name, unit: p.unit } : undefined;
  };
}
