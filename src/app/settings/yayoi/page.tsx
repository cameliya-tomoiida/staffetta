import { connection } from "next/server";
import { PageHeader } from "@/components/ui";
import { todayJst } from "@/lib/clock";
import type { DeliverySlip } from "@/lib/slips/calc";
import { slipsBetween } from "@/lib/slips/store";
import { getYayoiFormat } from "@/lib/slips/yayoi-format-store";
import { YayoiFormatClient } from "./YayoiFormatClient";

export const metadata = { title: "弥生の CSV の様式｜設定" };

// 見本に使う伝票（直近の確定した売上から3行。無ければ架空の1枚）
const SAMPLE: DeliverySlip = {
  no: "D-20261106-C001",
  date: "2026-11-06",
  customerId: "C001",
  customerName: "見本の取引先（デモ）",
  lines: [
    { productId: "P001", code: "1001", name: "バターロール", quantity: 30, unit: "個", unitPrice: 38, amount: 1140, taxRate: 8, priceFrom: "卸価格" },
    { productId: "P002", code: "1002", name: "食パン 6枚切", quantity: 10, unit: "斤", unitPrice: 160, amount: 1600, taxRate: 8, priceFrom: "卸価格" },
    { productId: "P003", name: "配送料", quantity: 1, unit: "式", unitPrice: 500, amount: 500, taxRate: 10, priceFrom: "売価" },
  ],
  totals: { byRate: [], net: 3240, tax: 0, total: 3240 },
  orderIds: [],
};

// 弥生販売に取り込む CSV の様式（作者 11/6 担当者「配列は今は分からないので、後から入れられるように」）
export default async function YayoiFormatPage() {
  await connection();
  const today = todayJst();
  let sample: DeliverySlip[] = [];
  try {
    const slips = await slipsBetween(todayJst(-45), today);
    let n = 0;
    for (const s of slips.reverse()) {
      if (n >= 3) break;
      const lines = s.lines.slice(0, 3 - n);
      n += lines.length;
      sample.push({ ...s, lines });
    }
  } catch {
    sample = [];
  }
  if (!sample.length) sample = [SAMPLE];
  return (
    <div className="space-y-5">
      <PageHeader
        title="弥生の CSV の様式"
        lead="「伝票」の画面から出す、弥生販売に取り込む CSV の形です。弥生の取り込みの画面に合わせて、列の順・見出し・文字コード・日付の形を変えられます。弥生で書き出した CSV の1行目（見出し）を貼ると、その並びを作ります。"
      />
      <YayoiFormatClient initial={getYayoiFormat()} sample={sample} />
    </div>
  );
}
