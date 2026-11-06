"use client";
// 取引先の一覧を、サーバーの画面（マスタ・DB）からクライアントの部品へ渡す（作者 11/6）。
// 見本の固定の一覧（src/data/master.ts）ではなく、こちらを使う。
import { createContext, useContext } from "react";

export interface CustomerLite {
  id: string;
  name: string;
  channel?: string;
  fax?: string;
}

const Ctx = createContext<CustomerLite[]>([]);

export function CustomersProvider({ list, children }: { list: CustomerLite[]; children: React.ReactNode }) {
  return <Ctx.Provider value={list}>{children}</Ctx.Provider>;
}

export const useCustomers = () => useContext(Ctx);
