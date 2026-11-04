import { redirect } from "next/navigation";

// packaging は⑤の /masters/packaging が正（CSV のプレビュー→確定・棚卸・使わない／戻す つき）
export default function Page() {
  redirect("/masters/packaging");
}
