import { redirect } from "next/navigation";

// materials は⑤の /masters/materials が正（CSV のプレビュー→確定・棚卸・使わない／戻す つき）
export default function Page() {
  redirect("/masters/materials");
}
