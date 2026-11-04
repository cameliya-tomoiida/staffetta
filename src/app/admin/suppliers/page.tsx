import { redirect } from "next/navigation";

// suppliers は⑤の /masters/suppliers が正（CSV のプレビュー→確定・棚卸・使わない／戻す つき）
export default function Page() {
  redirect("/masters/suppliers");
}
